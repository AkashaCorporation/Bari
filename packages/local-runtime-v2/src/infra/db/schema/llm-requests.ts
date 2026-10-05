import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const llmRequests = sqliteTable(
  'local_runtime_llm_requests',
  {
    requestId: text('request_id').primaryKey(),
    sessionId: text('session_id').notNull(),
    turnId: text('turn_id').notNull(),
    agentName: text('agent_name').notNull(),
    rootSessionId: text('root_session_id').notNull(),
    ancestryJson: text('ancestry_json').notNull(),
    attributionIncomplete: integer('attribution_incomplete').notNull().default(0),
    category: text('category').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    caller: text('caller').notNull(),
    scope: text('scope').notNull(),
    startedAtMs: integer('started_at_ms').notNull(),
    endedAtMs: integer('ended_at_ms'),
    outcome: text('outcome').notNull().default('pending'),
    /** Why this attempt settled; a closed vocabulary, never provider error text. */
    settleReason: text('settle_reason'),
    usageStatus: text('usage_status').notNull().default('pending'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    totalTokens: integer('total_tokens'),
    costUsd: real('cost_usd'),
  },
  (table) => [
    index('idx_llm_requests_session_time').on(table.sessionId, table.startedAtMs),
    index('idx_llm_requests_root_time').on(table.rootSessionId, table.startedAtMs),
  ],
);

export const requestAccountingState = sqliteTable('local_runtime_request_accounting_state', {
  singleton: integer('singleton').primaryKey(),
  sinceMs: integer('since_ms').notNull(),
  legacyLastId: integer('legacy_last_id').notNull(),
  degraded: integer('degraded').notNull().default(0),
});
