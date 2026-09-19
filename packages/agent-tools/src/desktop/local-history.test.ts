import { describe, expect, it, vi } from 'vitest';

import { LocalHistoryTool } from './local-history.js';
import type { LocalHistoryAdapter, LocalRuntimeToolContext } from './types.js';

describe('history tool', () => {
  it('maps adapter results into a history ToolResult', async () => {
    const adapter: LocalHistoryAdapter = {
      execute: vi.fn(async () => ({ text: 'search output', details: { matches: 2 } })),
    };
    const tool = new LocalHistoryTool(adapter);

    const result = await tool.execute(
      {} as LocalRuntimeToolContext,
      { operation: 'search', query: 'clamp' },
      undefined,
    );

    expect(result.tool_name).toBe('history');
    expect(result.text).toBe('search output');
    expect(result.details).toMatchObject({ kind: 'history', matches: 2 });
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.anything(),
      { operation: 'search', query: 'clamp' },
      undefined,
    );
  });
});
