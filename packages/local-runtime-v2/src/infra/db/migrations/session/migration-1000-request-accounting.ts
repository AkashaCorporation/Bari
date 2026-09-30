import type { MigrationEntry } from '../../migrate.js';

/** Bari-owned schema changes use 1000+ to avoid collisions with upstream migrations. */
export const REQUEST_ACCOUNTING_MIGRATION_VERSION = 1000;

/** Additive request ledger; never reinterpret or delete anonymous historical usage. */
export const migration: MigrationEntry = {
  version: REQUEST_ACCOUNTING_MIGRATION_VERSION,
  name: 'request_accounting',
  up(database) {
    database.exec(`
      CREATE TABLE local_runtime_llm_requests (
        request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
        agent_name TEXT NOT NULL, root_session_id TEXT NOT NULL, ancestry_json TEXT NOT NULL,
        attribution_incomplete INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, caller TEXT NOT NULL, scope TEXT NOT NULL,
        started_at_ms INTEGER NOT NULL, ended_at_ms INTEGER,
        outcome TEXT NOT NULL DEFAULT 'pending', usage_status TEXT NOT NULL DEFAULT 'pending',
        input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
        cache_read_tokens INTEGER, cache_write_tokens INTEGER, total_tokens INTEGER, cost_usd REAL
      );
      CREATE INDEX idx_llm_requests_session_time ON local_runtime_llm_requests(session_id, started_at_ms);
      CREATE INDEX idx_llm_requests_root_time ON local_runtime_llm_requests(root_session_id, started_at_ms);
      CREATE TABLE local_runtime_request_accounting_state (
        singleton INTEGER PRIMARY KEY, since_ms INTEGER NOT NULL,
        legacy_last_id INTEGER NOT NULL, degraded INTEGER NOT NULL DEFAULT 0
      );
    `);
    database
      .prepare(
        `INSERT INTO local_runtime_request_accounting_state(singleton, since_ms, legacy_last_id)
      SELECT 1, ?, coalesce(max(id), 0) FROM local_runtime_token_usage`,
      )
      .run(Date.now());
  },
};
