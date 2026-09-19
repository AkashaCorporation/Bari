import { bindTool, type ToolImpl, type ToolResult } from '@bari/agent-core/tools';

import { LocalHistoryToolDef, type LocalHistoryToolInput } from './builtin-defs.js';
import type { LocalHistoryAdapter, LocalRuntimeToolContext } from './types.js';

@bindTool(LocalHistoryToolDef)
export class LocalHistoryTool implements ToolImpl<
  typeof LocalHistoryToolDef.schema,
  LocalRuntimeToolContext
> {
  constructor(private readonly adapter: LocalHistoryAdapter) {}

  async execute(
    ctx: LocalRuntimeToolContext,
    input: LocalHistoryToolInput,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    if (signal?.aborted) throw new Error('Operation aborted');
    const result = await this.adapter.execute(ctx, input, signal);
    return {
      tool_name: LocalHistoryToolDef.name,
      text: result.text,
      content: [{ type: 'text', text: result.text }],
      details: { kind: 'history', ...(result.details ?? {}) },
    };
  }
}
