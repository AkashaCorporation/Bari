import { describe, expect, it, vi } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { Type } from '@sinclair/typebox';
import type { RuntimeTool, ToolResult } from '@bari/agent-core/tools';
import { createTeamTool } from './tool.js';
import { TeamService } from './service.js';
import { buildLocalTurnToolCatalog } from '../turn-system/agent-host/assembly/local-turn-tool-catalog.js';

function catalog(service: TeamService, tools: RuntimeTool[] = [], role: string = 'mavis', delegation = true, selection?: { tools?: string[]; disallowedTools?: string[] }) {
  return buildLocalTurnToolCatalog({
    sessionId: 'root', llmModel: { provider: 'test', id: 'small', contextWindow: 8000 },
    sources: { nativeTools: [...tools, createTeamTool(service, 'root')], mcpEntries: [], threadGoalTools: [], cuRuntimeAvailable: false },
    ...(role ? { agentProfile: {
      trustedBuiltin: true, canonicalRole: role, surface: 'cli' as const,
      capabilityCeiling: { features: { mavis: true, delegation, webSearch: true } },
      ...(selection ? { configSelection: selection } : {}),
    } } : {}),
  });
}
function fixture() {
  const service = new TeamService('unused-test-dir', {
    getSession: async () => undefined, listAgents: async () => [], listModels: async () => [], enqueue: async () => {}, cancel: async () => {},
  });
  const execute = vi.spyOn(service, 'execute').mockResolvedValue({ message: 'ok' });
  return { service, execute };
}
async function invoke(tool: RuntimeTool, command: Record<string, unknown>): Promise<ToolResult> {
  return tool.impl.execute({ sessionId: 'root', turnId: 'turn' }, { command });
}
const rawTask: RuntimeTool = { def: { name: 'task', description: 'task', schema: Type.Object({}) }, impl: { execute: async () => ({ tool_name: 'task', text: '', content: [], details: { task_id: 'rt', sub_session_id: 'child' } }) } };

describe('team_coordination productive catalog policy', () => {
  it('publishes discriminated command schemas without a model-controlled caller', async () => {
    const f = fixture(); const tool = catalog(f.service).tools.find(t => t.def.name === 'team_coordination')!;
    expect(Value.Check(tool.def.schema, { command: { action: 'status' } })).toBe(true);
    expect(Value.Check(tool.def.schema, { command: { action: 'review-task', taskId: 'x', expectedRevision: 2, decision: 'approve', feedback: '' } })).toBe(true);
    expect(Value.Check(tool.def.schema, { command: { action: 'status', sessionId: 'spoof' } })).toBe(false);
    await invoke(tool, { action: 'status' });
    expect(f.execute).toHaveBeenCalledWith({ action: 'status', sessionId: 'root' }, expect.any(Object));
    const rejected = await invoke(tool, { action: 'status', sessionId: 'spoof' });
    expect(rejected.isError).toBe(true);
  });
  it('cannot delegate through tools excluded from the admitted catalog', async () => {
    const f = fixture();
    f.execute.mockImplementation(async (_request, execution) => {
      await execution!.start({ id: 'x', revision: 1, title: 'Task', instructions: 'work', member: 'worker', dependencies: [], status: 'pending' }, { name: 'worker', agentName: 'worker' });
      return { message: 'started' };
    });
    const tool = catalog(f.service).tools.find(t => t.def.name === 'team_coordination')!;
    expect((await invoke(tool, { action: 'start-task', taskId: 'x' })).text).toContain('not admitted');
    const allowed = catalog(f.service, [rawTask]).tools.find(t => t.def.name === 'team_coordination')!;
    expect((await invoke(allowed, { action: 'start-task', taskId: 'x' })).isError).not.toBe(true);
  });
  it('blocks canonical read-only mutation, keeps participation separate from delegation, and respects selectors', async () => {
    const f = fixture();
    const readonly = catalog(f.service, [rawTask], 'explore').tools.find(t => t.def.name === 'team_coordination')!;
    expect((await invoke(readonly, { action: 'message', toSessionId: 'root', content: 'change' })).text).toContain('Read-only');
    expect(f.execute).not.toHaveBeenCalled();
    expect(catalog(f.service, [rawTask], 'mavis', false).tools.some(t => t.def.name === 'team_coordination')).toBe(true);
    expect(catalog(f.service, [rawTask], 'mavis', true, { disallowedTools: ['team_coordination'] }).tools.some(t => t.def.name === 'team_coordination')).toBe(false);
  });
  it('pins the member model in the real task arguments and always starts background work', async () => {
    const f = fixture(); const taskExecute = vi.fn(rawTask.impl.execute);
    f.execute.mockImplementation(async (_request, execution) => {
      const result = await execution!.start({ id: 'board-id', revision: 1, title: 'Task', instructions: 'work', member: 'worker', dependencies: [], status: 'pending' }, { name: 'worker', agentName: 'worker', model: { providerId: 'gateway', modelId: 'small' } });
      expect(result).toEqual({ taskId: 'rt', sessionId: 'child' });
      return { message: 'started' };
    });
    const tool = catalog(f.service, [{ ...rawTask, impl: { execute: taskExecute } }]).tools.find(t => t.def.name === 'team_coordination')!;
    await invoke(tool, { action: 'start-task', taskId: 'board-id' });
    expect(taskExecute).toHaveBeenCalledWith({ sessionId: 'root', turnId: 'turn' }, expect.objectContaining({ run_in_background: true, model: 'gateway/small', agent_name: 'worker' }), undefined);
  });
});
