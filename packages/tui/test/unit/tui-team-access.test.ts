import { describe, expect, it, vi } from 'vitest';
import { TuiRuntimeAdapter } from '../../src/runtime/adapter.js';
import type { TeamCommandRequest } from '@bari/local-runtime-v2/cli-service';

describe('Agent Teams Runtime adapter', () => {
  it('forwards the exact typed request to the real CliService facade', async () => {
    const response = { message: 'Queued', queued: true };
    const executeTeamCommand = vi.fn(async () => response);
    const adapter = new TuiRuntimeAdapter({ executeTeamCommand } as never);
    const request: TeamCommandRequest = { action: 'continue-task', sessionId: 'root', taskId: 't1', content: 'Check evidence' };
    await expect(adapter.executeTeamCommand(request)).resolves.toBe(response);
    expect(executeTeamCommand).toHaveBeenCalledExactlyOnceWith(request);
  });

  it('does not turn backend denial into success', async () => {
    const adapter = new TuiRuntimeAdapter({ executeTeamCommand: vi.fn(async () => { throw new Error('Unauthorized reviewer'); }) } as never);
    await expect(adapter.executeTeamCommand({ action: 'status', sessionId: 'root' })).rejects.toThrow('Unauthorized reviewer');
  });

  it('reports an unavailable capability for older hosts', async () => {
    const adapter = new TuiRuntimeAdapter({} as never);
    await expect(adapter.executeTeamCommand({ action: 'list', sessionId: 'root' })).rejects.toThrow('Agent Teams is unavailable');
  });
});
