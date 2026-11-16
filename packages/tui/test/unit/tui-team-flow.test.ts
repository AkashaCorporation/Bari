import { describe, expect, it, vi } from 'vitest';
import { TuiTeamFlow } from '../../src/tui/controller/product/team-flow.js';
import { TuiCommandFlow } from '../../src/tui/controller/product/command-flow.js';
import { createTuiCommandCatalog } from '../../src/tui/commands/catalog.js';
import type { TuiSession } from '../../src/runtime/port.js';
import type { TuiTeamPresetPanel } from '../../src/tui/agent-team/preset-panel.js';

function harness() {
  let session: TuiSession | undefined = { sessionId: 'root' };
  let panel: TuiTeamPresetPanel | undefined;
  const executeTeamCommand = vi.fn(async () => ({ message: 'No active team', presets: [], agents: [] }));
  const listModels = vi.fn(async () => []);
  const append = vi.fn();
  const close = vi.fn(() => true);
  const pushFeature = vi.fn(({ screen }) => { panel = screen; return { id: screen.id, close, isActive: () => true }; });
  const flow = new TuiTeamFlow({
    runtime: { executeTeamCommand, listModels }, currentSession: () => session,
    surfaceHost: { pushFeature }, showTasks: vi.fn(), append, requestRender: vi.fn(),
  });
  return { flow, executeTeamCommand, listModels, append, pushFeature, close, panel: () => panel, session: (value: TuiSession | undefined) => { session = value; } };
}

function commandFlow(showTeam?: () => Promise<void>) {
  const append = vi.fn();
  const submit = vi.fn();
  const flow = new TuiCommandFlow({
    workspaceDir: '/workspace',
    controller: { snapshot: () => ({ status: 'idle', sessions: [], session: { sessionId: 'root' } }), submit } as never,
    featureFlow: { skillCommands: () => [], waitForWelcomeModelSelection: async () => undefined, applyPendingModelSelection: async () => undefined } as never,
    activeRunFlow: {} as never, feedbackFlow: {} as never, sessionMutationFlow: {} as never,
    updateFlow: {} as never, sessionFlow: {} as never, queueFlow: {} as never,
    interactionFlow: { handleCommand: async () => false, hasPending: () => false } as never,
    composerDraft: { hasContent: () => false } as never,
    workspaceRoots: { additionalDirectories: () => [] } as never,
    runProjection: { snapshot: () => ({ queuedCount: 0 }) } as never,
    editor: {} as never, surface: {} as never, surfaceHost: {} as never,
    showTeam, queueEnabled: true, liveRunId: () => undefined, runtimeStopping: () => false,
    abortLiveTurn: async () => false, leaveUi: async () => undefined, whenReady: async () => undefined,
    append, setHint: vi.fn(), onChanged: vi.fn(),
  });
  return { flow, append, submit };
}

describe('Agent Teams product command / flow', () => {
  it('exposes /team in autocomplete and resolves /teams through the real catalog', () => {
    const catalog = createTuiCommandCatalog([], { team: vi.fn() }, () => ({
      hasSession: true, hasParentSession: false, managedTokenPresent: false, queueEnabled: true,
      hasLiveRun: false, queuedCount: 0, canRetry: false, sideMode: false,
    }));
    expect(catalog.slashCommands.some((command) => command.name === 'team')).toBe(true);
    expect(catalog.resolve('/teams')?.name).toBe('team');
  });

  it.each(['/team', '/teams'])('dispatches %s to the mounted Runtime-backed feature without a chat turn', async (input) => {
    const h = harness();
    const commands = commandFlow(() => h.flow.show());
    await expect(commands.flow.submit(input)).resolves.toBe('consumed');
    expect(h.executeTeamCommand).toHaveBeenCalledWith({ action: 'list', sessionId: 'root' });
    expect(h.executeTeamCommand).toHaveBeenCalledWith({ action: 'status', sessionId: 'root' });
    expect(h.listModels).toHaveBeenCalledWith('root');
    expect(h.pushFeature).toHaveBeenCalledOnce();
    expect(commands.submit).not.toHaveBeenCalled();
    expect(h.append).not.toHaveBeenCalled();
  });

  it('clearly reports a missing command host instead of pretending to open a panel', async () => {
    const h = commandFlow();
    await h.flow.submit('/team');
    expect(h.append).toHaveBeenCalledWith('Agent Teams is unavailable in this host.', 'error');
  });

  it('preserves older runtime mocks with an unavailable capability message', async () => {
    const append = vi.fn();
    const flow = new TuiTeamFlow({ runtime: { listModels: vi.fn() }, currentSession: () => ({ sessionId: 'root' }), surfaceHost: { pushFeature: vi.fn() }, showTasks: vi.fn(), append, requestRender: vi.fn() });
    await flow.show();
    expect(append).toHaveBeenCalledWith('Agent Teams is unavailable in this Runtime.', 'error');
  });

  it('shows actual backend failures and does not mount a fake successful panel', async () => {
    const h = harness();
    h.executeTeamCommand.mockRejectedValueOnce(new Error('Catalog denied'));
    await h.flow.show();
    expect(h.pushFeature).not.toHaveBeenCalled();
    expect(h.append).toHaveBeenCalledWith('Agent Teams: Catalog denied', 'error');
  });

  it('pins requests to the session that opened the panel', async () => {
    const h = harness();
    await h.flow.show();
    h.session({ sessionId: 'different' });
    h.panel()!.handleInput('\r');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.panel()!.render(100).join('\n')).toContain('selected session changed');
    expect(h.executeTeamCommand).toHaveBeenCalledTimes(2);
  });
});
