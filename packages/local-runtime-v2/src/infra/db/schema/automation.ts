import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const automationState = sqliteTable("bari_automation_state", {
  key: text("key").primaryKey(),
  generation: integer("generation").notNull().default(0),
  valueJson: text("value_json").notNull().default("{}"),
  updatedAtMs: integer("updated_at_ms").notNull(),
});
export const automationRuns = sqliteTable(
  "bari_automation_runs",
  {
    runId: text("run_id").primaryKey(),
    parentSessionId: text("parent_session_id").notNull(),
    sourceTurnId: text("source_turn_id").notNull(),
    agentName: text("agent_name").notNull(),
    workspaceDir: text("workspace_dir").notNull(),
    workspaceKey: text("workspace_key").notNull(),
    groupKey: text("group_key").notNull(),
    generation: integer("generation").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    startedAtMs: integer("started_at_ms"),
    endedAtMs: integer("ended_at_ms"),
    state: text("state").notNull().default("pending"),
    reason: text("reason"),
    childSessionId: text("child_session_id"),
    childTurnId: text("child_turn_id"),
    reportJson: text("report_json"),
  },
  (table) => [
    uniqueIndex("bari_automation_source_turn").on(
      table.parentSessionId,
      table.sourceTurnId,
    ),
    index("bari_automation_pending").on(table.state, table.createdAtMs),
    index("bari_automation_budget").on(table.startedAtMs),
    index("bari_automation_group").on(table.groupKey, table.startedAtMs),
  ],
);
export const automationChanges = sqliteTable(
  "bari_automation_changes",
  {
    changeId: text("change_id").primaryKey(),
    runId: text("run_id").notNull(),
    kind: text("kind").notNull(),
    target: text("target").notNull(),
    beforeHash: text("before_hash").notNull(),
    afterHash: text("after_hash").notNull(),
    beforeText: text("before_text"),
    afterText: text("after_text"),
    state: text("state").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    evidenceJson: text("evidence_json").notNull(),
  },
  (table) => [
    index("bari_automation_change_run").on(table.runId, table.createdAtMs),
  ],
);
