import type { MigrationEntry } from "../../migrate.js";
export const AUTOMATION_MIGRATION_VERSION = 1001;
export const migration: MigrationEntry = {
  version: AUTOMATION_MIGRATION_VERSION,
  name: "bari_automatic_workflows",
  up: `
    CREATE TABLE bari_automation_state (
      key TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0,
      value_json TEXT NOT NULL DEFAULT '{}', updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE bari_automation_runs (
      run_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL, source_turn_id TEXT NOT NULL,
      agent_name TEXT NOT NULL, workspace_dir TEXT NOT NULL, workspace_key TEXT NOT NULL,
      group_key TEXT NOT NULL, generation INTEGER NOT NULL, created_at_ms INTEGER NOT NULL,
      started_at_ms INTEGER, ended_at_ms INTEGER, state TEXT NOT NULL DEFAULT 'pending', reason TEXT,
      child_session_id TEXT, child_turn_id TEXT, report_json TEXT
    );
    CREATE UNIQUE INDEX bari_automation_source_turn ON bari_automation_runs(parent_session_id, source_turn_id);
    CREATE INDEX bari_automation_pending ON bari_automation_runs(state, created_at_ms);
    CREATE INDEX bari_automation_budget ON bari_automation_runs(started_at_ms);
    CREATE INDEX bari_automation_group ON bari_automation_runs(group_key, started_at_ms);
    CREATE TABLE bari_automation_changes (
      change_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
      before_hash TEXT NOT NULL, after_hash TEXT NOT NULL, before_text TEXT, after_text TEXT,
      state TEXT NOT NULL, created_at_ms INTEGER NOT NULL, evidence_json TEXT NOT NULL
    );
    CREATE INDEX bari_automation_change_run ON bari_automation_changes(run_id, created_at_ms);
  `,
};
