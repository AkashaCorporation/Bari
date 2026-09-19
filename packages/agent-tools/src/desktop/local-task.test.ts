import { describe, expect, it, vi } from 'vitest';

import { LocalTaskTool } from './local-task.js';
import type { LocalRuntimeToolContext, LocalTaskAdapter } from './types.js';

function fakeContext(): LocalRuntimeToolContext {
  return {} as LocalRuntimeToolContext;
}

describe('delegated task tool', () => {
  it('aborts a foreground task when timeout_ms elapses and reports the timeout', async () => {
    const adapter: LocalTaskAdapter = {
      runForeground: (_ctx, _input, signal) =>
        new Promise((resolve) => {
          const abort = () => resolve({ status: 'aborted', requestedAgentName: 'june' });
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        }),
      startBackground: vi.fn(async () => ({ status: 'failed' as const })),
    };
    const tool = new LocalTaskTool(adapter);

    const result = await tool.execute(
      fakeContext(),
      { description: 'slow task', prompt: 'work', agent_name: 'june', timeout_ms: 30 },
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(result.text).toContain('run_status: aborted');
    expect(result.text).toContain('timed out after 30 ms');
    expect(result.text).toContain('duration_ms:');
  });

  it('omits empty verification fields and reports duration on success', async () => {
    const adapter: LocalTaskAdapter = {
      runForeground: async () => ({
        status: 'succeeded',
        requestedAgentName: 'explore',
        resolvedAgentName: 'explore',
        finalText: 'done',
      }),
      startBackground: vi.fn(async () => ({ status: 'failed' as const })),
    };
    const tool = new LocalTaskTool(adapter);

    const result = await tool.execute(
      fakeContext(),
      { description: 'mapping', prompt: 'map it', agent_name: 'explore' },
      undefined,
    );

    expect(result.isError).toBeUndefined();
    expect(result.text).toContain('run_status: succeeded');
    expect(result.text).toContain('duration_ms:');
    expect(result.text).toContain('final_text:');
    expect(result.text).not.toContain('model_verdict: missing');
    expect(result.text).not.toContain('file_change: missing');
  });
});
