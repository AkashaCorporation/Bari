import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamService, type TeamPorts, type TeamSession, type TeamExecution } from './service.js';
import type { TeamPreset } from './contracts.js';
import { TeamStore } from './store.js';
import { isTeamCommand } from './schema.js';
import { LocalModelResolver } from '../model-system/resolution/local-model-resolver.js';
import type { LocalConversationRuntimeConfig } from '../model-system/index.js';
import { LocalAgentConfigBuilder } from '../turn-system/agent-host/preparation/config/local-agent-config-builder.js';
import { LocalAgentPreparationService } from '../turn-system/agent-host/preparation/local-agent-preparation-service.js';
import type { SessionRecord } from '../session-system/index.js';
import { teamRuntimeProvider } from './runtime-model.js';
import { rm } from 'node:fs/promises';

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const cheap = { providerId: 'custom_provider:work', modelId: 'manufacturer-small' };
const expensive = { providerId: 'custom_provider:work', modelId: 'manufacturer-large' };
const preset: TeamPreset = { name: 'HexCore', members: [{ name: 'investigator', agentName: 'worker', model: cheap }], policy: { mode: 'family', family: 'Explicit small-model selection', models: [cheap] } };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'bari-team-test-')); directories.push(dir);
  const sessions = new Map<string, TeamSession>([
    ['root', { sessionId: 'root', sessionKind: 'root', status: 'idle', archived: false }],
    ['other', { sessionId: 'other', sessionKind: 'root', status: 'idle', archived: false }],
  ]);
  const ports: TeamPorts = {
    getSession: async id => sessions.get(id),
    listAgents: async () => [{ name: 'worker', displayName: 'Worker' }],
    listModels: async () => [cheap, expensive],
    enqueue: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
  };
  const service = new TeamService(dir, ports);
  const execute: TeamExecution = {
    start: vi.fn(async () => {
      sessions.set('child', { sessionId: 'child', parentSessionId: 'root', sessionKind: 'task', status: 'idle', archived: false });
      return { sessionId: 'child', taskId: 'runtime-task' };
    }),
    continue: vi.fn(async () => ({ taskId: 'runtime-task' })),
  };
  const send = (action: 'list' | 'status') => service.execute({ sessionId: 'root', action });
  const activate = async () => {
    await service.execute({ sessionId: 'root', action: 'save-preset', preset });
    await service.execute({ sessionId: 'root', action: 'activate', name: 'HexCore' });
  };
  const create = async (dependencies: string[] = []) => {
    const result = await service.execute({ sessionId: 'root', action: 'create-task', title: 'Inspect', instructions: 'Find evidence', member: 'investigator', dependencies });
    return result.snapshot!.tasks.at(-1)!;
  };
  return { dir, sessions, ports, service, execute, send, activate, create };
}

describe('Agent Teams authoritative metadata', () => {
  it('no active team is normal; inheritance without a team is unchanged', async () => {
    const f = await fixture();
    expect((await f.send('status')).snapshot).toBeUndefined();
    await expect(f.service.assertModel({ sessionId: 'nested', parentSessionId: 'root', sessionKind: 'task', status: 'idle', archived: false }, expensive)).resolves.toBeUndefined();
  });
  it('persists named compositions/active root/board across reopen without credentials or session copies', async () => {
    const f = await fixture(); await f.activate(); await f.create();
    const reopened = new TeamService(f.dir, f.ports);
    expect((await reopened.execute({ sessionId: 'root', action: 'status' })).snapshot?.preset).toEqual(preset);
    const body = await readFile(join(f.dir, 'v2', 'teams.json'), 'utf8');
    expect(body).not.toContain('apiKey'); expect(body).not.toContain('mailbox');
  });
  it('queues CLI launch requests honestly and binds actual runtime references only on admission', async () => {
    const f = await fixture(); await f.activate(); const task = await f.create();
    const queued = await f.service.execute({ sessionId: 'root', action: 'start-task', taskId: task.id });
    expect(queued.queued).toBe(true); expect(queued.snapshot?.tasks[0]?.status).toBe('pending');
    expect(f.execute.start).not.toHaveBeenCalled();
    const started = await f.service.execute({ sessionId: 'root', action: 'start-task', taskId: task.id }, f.execute);
    expect(started.snapshot?.tasks[0]).toMatchObject({ sessionId: 'child', runtimeTaskId: 'runtime-task', status: 'running' });
    // A real idle worker remains running/unreviewed, not autoapproved.
    expect((await f.send('status')).snapshot?.tasks[0]?.status).toBe('running');
  });
  it('requires explicit submission and root review, with an exact revision guard', async () => {
    const f = await fixture(); await f.activate(); const task = await f.create();
    await f.service.execute({ sessionId: 'root', action: 'start-task', taskId: task.id }, f.execute);
    await expect(f.service.execute({ sessionId: 'root', action: 'review-task', taskId: task.id, expectedRevision: 2, decision: 'approve', feedback: 'ok' })).rejects.toThrow('explicitly submitted');
    const submitted = await f.service.execute({ sessionId: 'child', action: 'submit-task', taskId: task.id, delivery: 'Evidence A' });
    const revision = submitted.snapshot!.tasks[0]!.revision;
    await expect(f.service.execute({ sessionId: 'child', action: 'review-task', taskId: task.id, expectedRevision: revision, decision: 'approve', feedback: 'self' })).rejects.toThrow('leader');
    await f.service.execute({ sessionId: 'root', action: 'continue-task', taskId: task.id, content: 'Try again' }, f.execute);
    await f.service.execute({ sessionId: 'child', action: 'submit-task', taskId: task.id, delivery: 'Evidence B' });
    await expect(f.service.execute({ sessionId: 'root', action: 'review-task', taskId: task.id, expectedRevision: revision, decision: 'approve', feedback: 'stale' })).rejects.toThrow('changed');
    const current = (await f.send('status')).snapshot!.tasks[0]!;
    const reviewed = await f.service.execute({ sessionId: 'root', action: 'review-task', taskId: task.id, expectedRevision: current.revision, decision: 'approve', feedback: 'Evidence B checked' });
    expect(reviewed.snapshot?.tasks[0]?.status).toBe('approved');
  });
  it('blocks unapproved dependencies and unauthorized session communication', async () => {
    const f = await fixture(); await f.activate(); const first = await f.create(); const second = await f.create([first.id]);
    await expect(f.service.execute({ sessionId: 'root', action: 'start-task', taskId: second.id }, f.execute)).rejects.toThrow('leader-approved');
    await expect(f.service.execute({ sessionId: 'other', action: 'message', toSessionId: 'root', content: 'intrusion' })).rejects.toThrow('No active team');
    await expect(f.service.execute({ sessionId: 'root', action: 'message', toSessionId: 'other', content: 'leak' })).rejects.toThrow('not a team member');
    expect(f.ports.enqueue).not.toHaveBeenCalled();
  });
  it('uses only session queues for messages and lets the leader record a read-only worker delivery explicitly', async () => {
    const f = await fixture(); await f.activate(); const task = await f.create();
    await f.service.execute({ sessionId: 'root', action: 'start-task', taskId: task.id }, f.execute);
    await f.service.execute({ sessionId: 'child', action: 'message', toSessionId: 'root', content: 'private-queue-body' });
    expect(f.ports.enqueue).toHaveBeenCalledWith('root', expect.stringContaining('private-queue-body'));
    expect(await readFile(join(f.dir, 'v2', 'teams.json'), 'utf8')).not.toContain('private-queue-body');
    const recorded = await f.service.execute({ sessionId: 'root', action: 'submit-task', taskId: task.id, delivery: 'Evidence read from read-only worker result' });
    expect(recorded.snapshot?.tasks[0]?.status).toBe('submitted');
    expect(recorded.snapshot?.tasks[0]?.review).toBeUndefined();
  });
  it('enforces explicit family allowlist on nested workers, not the hosting provider family', async () => {
    const f = await fixture(); await f.activate();
    f.sessions.set('nested', { sessionId: 'nested', parentSessionId: 'root', sessionKind: 'task', status: 'idle', archived: false });
    const descendant = { sessionId: 'grandchild', parentSessionId: 'nested', sessionKind: 'task', status: 'idle', archived: false };
    await expect(f.service.assertModel(descendant, cheap)).resolves.toBeUndefined();
    await expect(f.service.assertModel(descendant, expensive)).rejects.toThrow('no fallback');
  });
  it('blocks the real resolver fallback after an allowed custom model disappears, before preparation returns', async () => {
    const f = await fixture(); await f.activate();
    const config: LocalConversationRuntimeConfig = {
      defaultModel: 'minimax/MiniMax-M3',
      provider: { minimax: { options: { apiKey: 'test-only', baseURL: 'https://example.invalid' }, models: { 'MiniMax-M3': {} } } },
      custom_provider: { work: { enabled: true, options: { apiKey: 'test-only', baseURL: 'https://example.invalid' }, models: {} } },
    };
    const builder = new LocalAgentConfigBuilder({
      config: () => config,
      skills: { listRuntimeSkills: async () => ({ skills: [] }), renderCatalog: async () => '' },
      assertTeamResolvedModel: (session, selected, actual) => f.service.assertResolvedModel(session, selected, actual, () => teamRuntimeProvider(config, selected)),
    });
    vi.spyOn(builder, 'buildPrepared').mockResolvedValue({ agentConfig: { system_prompt: '', tools: [], skills: [], model: { provider: cheap.providerId, model_id: cheap.modelId } }, outputRevisionInstruction: '' });
    const resolver = new LocalModelResolver({ providerConfig: config.provider, byokConfigGetter: () => config });
    const resolved = vi.spyOn(resolver, 'resolveModel');
    const preparation = new LocalAgentPreparationService({ configBuilder: builder, modelResolver: resolver });
    const session: SessionRecord = { sessionId: 'child', parentSessionId: 'root', sessionKind: 'task', sessionType: 'branch', agentName: 'worker', workspaceDir: f.dir, runtime: 'pi-agent', status: 'idle', archived: false, createdAtMs: 1, updatedAtMs: 1 };
    await expect(preparation.prepareCompaction({ session, agent: { agentName: 'worker', systemPrompt: '' }, turnId: 'turn', history: { revision: '1', messages: [] } })).rejects.toThrow('no fallback');
    expect((await resolved.mock.results[0]!.value).model).toMatchObject({ provider: 'minimax', id: 'MiniMax-M3' });
  });
  it('maps an explicitly configured OAuth runtime provider without treating its host as a model family', async () => {
    const f = await fixture(); await f.activate();
    const config: LocalConversationRuntimeConfig = { custom_provider: { work: { kind: 'oauth', api: 'openai-responses', options: { authMode: 'oauth', baseURL: 'https://example.invalid' }, models: { [cheap.modelId]: {} } } } };
    expect(teamRuntimeProvider(config, cheap)).toBe('work');
    await expect(f.service.assertResolvedModel({ sessionId: 'child', parentSessionId: 'root', sessionKind: 'task', status: 'idle', archived: false }, cheap, { providerId: 'work', modelId: cheap.modelId }, () => teamRuntimeProvider(config, cheap))).resolves.toBeUndefined();
    // Same transport but a different model still cannot pass.
    await expect(f.service.assertResolvedModel({ sessionId: 'child', parentSessionId: 'root', sessionKind: 'task', status: 'idle', archived: false }, cheap, { providerId: 'work', modelId: expensive.modelId }, () => teamRuntimeProvider(config, cheap))).rejects.toThrow('fallback');
  });
  it('keeps errors and cancellations visible without approving deliveries', async () => {
    const f = await fixture(); await f.activate(); const task = await f.create();
    await expect(f.service.execute({ sessionId: 'root', action: 'start-task', taskId: task.id }, { ...f.execute, start: async () => { throw new Error('admission denied'); } })).rejects.toThrow('admission denied');
    expect((await f.send('status')).snapshot?.tasks[0]).toMatchObject({ status: 'failed', error: 'admission denied' });
    await f.service.execute({ sessionId: 'root', action: 'cancel-task', taskId: task.id });
    expect((await f.send('status')).snapshot?.tasks[0]?.status).toBe('cancelled');
  });
  it('retries pre-admission failures safely without duplicating admitted workers', async () => {
    const f = await fixture(); await f.activate(); const task = await f.create();
    await expect(f.service.execute({ sessionId: 'root', action: 'start-task', taskId: task.id }, { ...f.execute, start: async () => { throw new Error('temporary pre-admission failure'); } })).rejects.toThrow('temporary');
    const admitted = await f.service.execute({ sessionId: 'root', action: 'start-task', taskId: task.id }, f.execute);
    expect(admitted.snapshot?.tasks[0]).toMatchObject({ sessionId: 'child', runtimeTaskId: 'runtime-task', status: 'running' });
    expect(f.execute.start).toHaveBeenCalledTimes(1);
    await expect(f.service.execute({ sessionId: 'root', action: 'start-task', taskId: task.id }, f.execute)).rejects.toThrow('safely retryable');
  });
  it('retains admitted handles and cancels the worker when post-launch lookup fails', async () => {
    const f = await fixture(); await f.activate(); const task = await f.create();
    const original = f.ports.getSession;
    const lookup = vi.spyOn(f.ports, 'getSession').mockImplementation(async id => {
      if (id === 'child') throw new Error('repository read failed');
      return original(id);
    });
    await expect(f.service.execute({ sessionId: 'root', action: 'start-task', taskId: task.id }, f.execute)).rejects.toThrow('repository read failed');
    lookup.mockRestore();
    expect(f.ports.cancel).toHaveBeenCalledWith('child');
    expect((await f.send('status')).snapshot?.tasks[0]).toMatchObject({ status: 'failed', sessionId: 'child', runtimeTaskId: 'runtime-task' });
  });
  it('rolls back an admitted worker if persisting its handles fails and keeps them for reconciliation', async () => {
    const f = await fixture(); await f.activate(); const task = await f.create();
    const original = f.service.store.save.bind(f.service.store);
    let writes = 0;
    vi.spyOn(f.service.store, 'save').mockImplementation(async state => {
      if (++writes === 2) throw new Error('disk write failed after admission');
      await original(state);
    });
    await expect(f.service.execute({ sessionId: 'root', action: 'start-task', taskId: task.id }, f.execute)).rejects.toThrow('disk write failed');
    expect(f.ports.cancel).toHaveBeenCalledWith('child');
    expect((await f.send('status')).snapshot?.tasks[0]).toMatchObject({ status: 'failed', sessionId: 'child', runtimeTaskId: 'runtime-task' });
  });
  it('serializes independent instances and rejects corrupted persistence instead of resetting it', async () => {
    const f = await fixture();
    const second = new TeamService(f.dir, f.ports);
    await Promise.all([
      f.service.execute({ sessionId: 'root', action: 'save-preset', preset }),
      second.execute({ sessionId: 'root', action: 'save-preset', preset: { ...preset, name: 'Other' } }),
    ]);
    expect((await f.send('list')).presets).toHaveLength(2);
    await writeFile(join(f.dir, 'v2', 'teams.json'), '{broken', 'utf8');
    await expect(f.send('list')).rejects.toThrow('Cannot read Agent Teams persistence');
  });
  it('rejects unknown models/agents, extra credential fields, and corrupt cyclic graphs', async () => {
    const f = await fixture();
    await expect(f.service.execute({ sessionId: 'root', action: 'save-preset', preset: { ...preset, members: [{ name: 'bad', agentName: 'missing' }] } })).rejects.toThrow('existing');
    expect(isTeamCommand({ sessionId: 'root', action: 'save-preset', preset: { ...preset, apiKey: 'must-never-be-persisted' } })).toBe(false);
    await expect(f.service.execute({ sessionId: 'root', action: 'save-preset', preset: { ...preset, members: [{ name: 'bad', agentName: 'worker', model: { providerId: 'custom_provider:work', modelId: 'missing' } }] } })).rejects.toThrow('catalog');
    const state = { version: 1 as const, presets: [preset], teams: [{ rootSessionId: 'root', preset, tasks: [
      { id: 'a', revision: 1, title: 'a', instructions: 'a', member: 'investigator', dependencies: ['b'], status: 'pending' as const },
      { id: 'b', revision: 1, title: 'b', instructions: 'b', member: 'investigator', dependencies: ['a'], status: 'pending' as const },
    ] }] };
    await expect(new TeamStore(f.dir).save(state)).rejects.toThrow('Cyclic');
  });
});
