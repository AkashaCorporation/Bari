import { describe, expect, it, vi } from 'vitest';
import type { TeamCommandResult, TeamSnapshot } from '@bari/local-runtime-v2/cli-service';
import { TuiTeamPresetPanel, type TuiTeamAction } from '../../src/tui/agent-team/preset-panel.js';
import { stripAnsi } from '../../src/tui/rendering/text.js';

const snapshot = (): TeamSnapshot => ({
  rootSessionId: 'root', preset: { name: 'HexCore', policy: { mode: 'inherit' }, members: [{ name: 'worker', agentName: 'worker' }] },
  tasks: [{ id: 'task-1', revision: 3, title: 'Audit', instructions: 'Check all callers', member: 'worker', dependencies: [], status: 'submitted', sessionId: 'child', delivery: 'Evidence v3' }],
  sessions: [{ sessionId: 'child', status: 'idle' }],
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const text = (panel: TuiTeamPresetPanel) => stripAnsi(panel.render(180).join('\n'));

async function choose(panel: TuiTeamPresetPanel, label: string): Promise<void> {
  for (let index = 0; index < 100; index++) {
    if (text(panel).includes(`> ${label}`)) { panel.handleInput('\r'); await settle(); return; }
    panel.handleInput('\u001b[B');
  }
  throw new Error(`No selectable item ${label}: ${text(panel)}`);
}
async function type(panel: TuiTeamPresetPanel, value: string): Promise<void> {
  panel.handleInput(value); panel.handleInput('\r'); await settle();
}
function harness(active = true) {
  const state = snapshot();
  const execute = vi.fn(async (_action: TuiTeamAction): Promise<TeamCommandResult> => ({ message: 'Saved', snapshot: state }));
  const onCancel = vi.fn();
  const onTasks = vi.fn();
  const panel = new TuiTeamPresetPanel({
    initial: { message: 'Loaded', presets: [state.preset], agents: [{ name: 'worker', displayName: 'Worker' }, { name: 'reviewer', displayName: 'Reviewer' }], ...(active ? { snapshot: state } : {}) },
    models: [{ providerId: 'custom-provider', modelId: 'model-a' }, { providerId: 'custom-provider', modelId: 'model-b' }],
    execute, onCancel, onTasks, requestRender: vi.fn(),
  });
  panel.focused = true;
  return { panel, execute, state, onCancel, onTasks };
}

async function savePreset(mode: 'allowlist' | 'family') {
  const h = harness(false);
  await choose(h.panel, 'Create or update preset');
  await type(h.panel, 'HexCore');
  await choose(h.panel, mode === 'allowlist' ? 'Exact model allowlist' : 'Declared family');
  if (mode === 'family') await type(h.panel, 'Explicit catalog family');
  await choose(h.panel, '[ ] custom-provider/model-a');
  await choose(h.panel, '[ ] custom-provider/model-b');
  await choose(h.panel, 'Continue with selected models');
  await choose(h.panel, '[ ] Worker');
  await choose(h.panel, '[ ] Reviewer');
  await choose(h.panel, 'Continue / assign member models');
  await choose(h.panel, 'custom-provider/model-a');
  await choose(h.panel, 'custom-provider/model-b');
  await choose(h.panel, 'Save HexCore');
  return h;
}

describe('Agent Teams keyboard panel', () => {
  it.each(['allowlist', 'family'] as const)('saves a named preset using existing agents and two exact catalog models (%s)', async (mode) => {
    const h = await savePreset(mode);
    expect(h.execute).toHaveBeenCalledWith({ action: 'save-preset', preset: {
      name: 'HexCore', members: [
        { name: 'worker', agentName: 'worker', model: { providerId: 'custom-provider', modelId: 'model-a' } },
        { name: 'reviewer', agentName: 'reviewer', model: { providerId: 'custom-provider', modelId: 'model-b' } },
      ], policy: { mode, ...(mode === 'family' ? { family: 'Explicit catalog family' } : {}), models: [
        { providerId: 'custom-provider', modelId: 'model-a' }, { providerId: 'custom-provider', modelId: 'model-b' },
      ] },
    } });
  });

  it('activates a saved preset and reuses /tasks for runtime transcripts', async () => {
    const h = harness(false);
    await choose(h.panel, 'Preset · HexCore');
    await choose(h.panel, 'Activate in this session');
    expect(h.execute).toHaveBeenCalledWith({ action: 'activate', name: 'HexCore' });
    expect(text(h.panel)).toContain('Active: HexCore');
    await choose(h.panel, 'Open /tasks for live agents');
    expect(h.onTasks).toHaveBeenCalledOnce();
  });

  it('keeps idle, submitted and reviewed as distinct states with visible delivery evidence', async () => {
    const h = harness();
    await choose(h.panel, 'Review team tasks');
    await choose(h.panel, '[SUBMITTED] Audit');
    expect(text(h.panel)).toContain('[SUBMITTED] ID task-1');
    expect(text(h.panel)).toContain('[RUNTIME IDLE] Session child · not a review decision');
    expect(text(h.panel)).toContain('Delivery: Evidence v3');
    expect(text(h.panel)).toContain('Review: not reviewed');
    expect(text(h.panel)).toContain('revision 3');
  });

  it('shows queue admission honestly and can continue a worker', async () => {
    const h = harness();
    await choose(h.panel, 'Review team tasks');
    await choose(h.panel, '[SUBMITTED] Audit');
    h.execute.mockResolvedValueOnce({ message: 'Request queued.', queued: true, snapshot: h.state });
    await choose(h.panel, 'Request start');
    expect(text(h.panel)).toContain('worker start is not confirmed');
    await choose(h.panel, '[SUBMITTED] Audit');
    await choose(h.panel, 'Continue worker');
    await type(h.panel, 'Check the new caller');
    expect(h.execute).toHaveBeenCalledWith({ action: 'continue-task', taskId: 'task-1', content: 'Check the new caller' });
  });

  it('submits delivery and sends messages without claiming review success on backend refusal', async () => {
    const h = harness();
    await choose(h.panel, 'Review team tasks');
    await choose(h.panel, '[SUBMITTED] Audit');
    await choose(h.panel, 'Submit delivery');
    await type(h.panel, 'New evidence');
    expect(h.execute).toHaveBeenCalledWith({ action: 'submit-task', taskId: 'task-1', delivery: 'New evidence' });
    await choose(h.panel, '[SUBMITTED] Audit');
    await choose(h.panel, 'Message session');
    await type(h.panel, 'Please explain');
    expect(h.execute).toHaveBeenCalledWith({ action: 'message', toSessionId: 'child', content: 'Please explain' });
  });

  it('reviews the displayed revision and refreshes after a stale-review rejection, never silently retrying approval', async () => {
    const h = harness();
    await choose(h.panel, 'Review team tasks');
    await choose(h.panel, '[SUBMITTED] Audit');
    await choose(h.panel, 'Review: approve');
    const newer = snapshot(); newer.tasks[0].revision = 4; newer.tasks[0].delivery = 'New delivery';
    h.execute.mockRejectedValueOnce(new Error('Task revision changed; refresh required')).mockResolvedValueOnce({ message: 'Current', snapshot: newer });
    await type(h.panel, 'Verified evidence v3');
    expect(h.execute).toHaveBeenCalledWith({ action: 'review-task', taskId: 'task-1', expectedRevision: 3, decision: 'approve', feedback: 'Verified evidence v3' });
    expect(h.execute.mock.calls.filter(([action]) => action.action === 'review-task')).toHaveLength(1);
    expect(h.execute).toHaveBeenLastCalledWith({ action: 'status' });
    expect(text(h.panel)).toContain('revision changed');
    await choose(h.panel, '[SUBMITTED] Audit');
    expect(text(h.panel)).toContain('revision 4');
    expect(text(h.panel)).toContain('New delivery');
  });

  it('creates a task assigned to a member with explicit dependencies', async () => {
    const h = harness();
    await choose(h.panel, 'Create task');
    await choose(h.panel, 'worker');
    await type(h.panel, 'Follow-up');
    await type(h.panel, 'Verify the patch');
    await choose(h.panel, '[ ] Audit');
    await choose(h.panel, 'Create task');
    expect(h.execute).toHaveBeenCalledWith({ action: 'create-task', title: 'Follow-up', instructions: 'Verify the patch', member: 'worker', dependencies: ['task-1'] });
  });

  it('surfaces backend policy errors, prevents duplicate mutations and allows escape', async () => {
    const h = harness(false);
    await choose(h.panel, 'Preset · HexCore');
    let reject!: (error: Error) => void;
    h.execute.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    h.panel.handleInput('\r'); h.panel.handleInput('\r');
    expect(h.execute).toHaveBeenCalledTimes(1);
    reject(new Error('Model policy rejected'));
    await settle();
    expect(text(h.panel)).toContain('Error: Model policy rejected');
    h.panel.handleInput('\u001b'); h.panel.handleInput('\u001b');
    expect(h.onCancel).toHaveBeenCalledOnce();
  });

  it('sanitizes runtime titles and descriptions, including the header', async () => {
    const h = harness();
    h.state.tasks[0].title = 'Audit\u001b[2J';
    await choose(h.panel, 'Review team tasks');
    await choose(h.panel, '[SUBMITTED] Audit');
    expect(h.panel.render(100).join('\n')).not.toContain('\u001b[2J');
  });
});
