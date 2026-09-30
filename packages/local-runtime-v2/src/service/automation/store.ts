import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { BariAutomationConfig } from "@bari/config";
import type { AppDb } from "../../infra/db/client.js";
import {
  automationChanges,
  automationRuns,
  automationState,
} from "../../infra/db/schema/automation.js";

export type LearningRun = typeof automationRuns.$inferSelect;
export type LearningChange = typeof automationChanges.$inferSelect;
export interface ComposeState {
  active: boolean;
  prompt: string;
  sourceTurnId: string;
}
const MAX_PENDING = 16;
const RETAINED_CHANGE_RUNS = 128;

/** Durable admission, fencing and operation journal; model output never chooses these identities. */
export class AutomationStore {
  constructor(
    readonly db: AppDb,
    private readonly now: () => number = Date.now,
  ) {}

  generation(sessionId: string): number {
    return (
      this.db
        .select()
        .from(automationState)
        .where(eq(automationState.key, `session:${sessionId}`))
        .get()?.generation ?? 0
    );
  }
  userActivity(sessionId: string): void {
    this.db
      .insert(automationState)
      .values({
        key: `session:${sessionId}`,
        generation: 1,
        updatedAtMs: this.now(),
      })
      .onConflictDoUpdate({
        target: automationState.key,
        set: {
          generation: sql`${automationState.generation} + 1`,
          updatedAtMs: this.now(),
        },
      })
      .run();
    this.db
      .update(automationRuns)
      .set({
        state: "cancelled",
        reason: "new_user_activity",
        endedAtMs: this.now(),
      })
      .where(
        and(
          eq(automationRuns.parentSessionId, sessionId),
          eq(automationRuns.state, "pending"),
        ),
      )
      .run();
  }
  compose(sessionId: string): ComposeState | undefined {
    const row = this.db
      .select()
      .from(automationState)
      .where(eq(automationState.key, `session:${sessionId}`))
      .get();
    const value = row
      ? (JSON.parse(row.valueJson) as { compose?: ComposeState })
      : {};
    return value.compose;
  }
  setCompose(sessionId: string, compose: ComposeState): void {
    this.db
      .insert(automationState)
      .values({
        key: `session:${sessionId}`,
        valueJson: JSON.stringify({ compose }),
        updatedAtMs: this.now(),
      })
      .onConflictDoUpdate({
        target: automationState.key,
        set: {
          valueJson: JSON.stringify({ compose }),
          updatedAtMs: this.now(),
        },
      })
      .run();
  }
  enqueue(
    input: Pick<
      LearningRun,
      | "parentSessionId"
      | "sourceTurnId"
      | "agentName"
      | "workspaceDir"
      | "workspaceKey"
      | "groupKey"
    >,
  ): LearningRun {
    return this.db.transaction(
      () => {
        const previous = this.db
          .select()
          .from(automationRuns)
          .where(
            and(
              eq(automationRuns.parentSessionId, input.parentSessionId),
              eq(automationRuns.sourceTurnId, input.sourceTurnId),
            ),
          )
          .get();
        if (previous) return previous;
        this.db
          .update(automationRuns)
          .set({
            state: "skipped",
            reason: "superseded",
            endedAtMs: this.now(),
          })
          .where(
            and(
              eq(automationRuns.parentSessionId, input.parentSessionId),
              eq(automationRuns.state, "pending"),
            ),
          )
          .run();
        const count = this.db
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(automationRuns)
          .where(eq(automationRuns.state, "pending"))
          .get()!.n;
        const runId = randomUUID();
        this.db
          .insert(automationRuns)
          .values({
            ...input,
            runId,
            generation: this.generation(input.parentSessionId),
            createdAtMs: this.now(),
            ...(count >= MAX_PENDING
              ? {
                  state: "skipped",
                  reason: "queue_full",
                  endedAtMs: this.now(),
                }
              : {}),
          })
          .run();
        return this.get(runId)!;
      },
      { behavior: "immediate" },
    );
  }
  pending(): LearningRun[] {
    return this.db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.state, "pending"))
      .orderBy(asc(automationRuns.createdAtMs))
      .limit(MAX_PENDING)
      .all();
  }
  get(runId: string): LearningRun | undefined {
    return this.db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.runId, runId))
      .get();
  }
  list(limit = 30): LearningRun[] {
    return this.db
      .select()
      .from(automationRuns)
      .orderBy(desc(automationRuns.createdAtMs))
      .limit(Math.max(1, Math.min(100, limit)))
      .all();
  }
  claim(run: LearningRun, config: BariAutomationConfig): boolean {
    return this.db.transaction(
      () => {
        const now = this.now();
        const current = this.get(run.runId);
        if (
          current?.state !== "pending" ||
          current.generation !== this.generation(run.parentSessionId)
        )
          return false;
        const lease = this.lease();
        if (lease && lease.expiresAt > now) return false;
        if (lease) this.finish(lease.runId, "interrupted", "owner_expired");
        const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
        const daily = this.db
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(automationRuns)
          .where(gte(automationRuns.startedAtMs, dayStart))
          .get()!.n;
        const last = this.db
          .select({ started: automationRuns.startedAtMs })
          .from(automationRuns)
          .where(eq(automationRuns.groupKey, run.groupKey))
          .orderBy(desc(automationRuns.startedAtMs))
          .limit(1)
          .get()?.started;
        if (
          daily >= config.maxRunsPerDay ||
          (last !== null &&
            last !== undefined &&
            now - last < config.cooldownMs)
        ) {
          this.finish(
            run.runId,
            "skipped",
            daily >= config.maxRunsPerDay ? "daily_budget" : "cooldown",
          );
          return false;
        }
        this.db
          .insert(automationState)
          .values({
            key: "lease",
            valueJson: JSON.stringify({
              runId: run.runId,
              expiresAt: now + config.timeoutMs + 10_000,
            }),
            updatedAtMs: now,
          })
          .onConflictDoUpdate({
            target: automationState.key,
            set: {
              valueJson: JSON.stringify({
                runId: run.runId,
                expiresAt: now + config.timeoutMs + 10_000,
              }),
              updatedAtMs: now,
            },
          })
          .run();
        this.db
          .update(automationRuns)
          .set({ state: "running", startedAtMs: now })
          .where(eq(automationRuns.runId, run.runId))
          .run();
        return true;
      },
      { behavior: "immediate" },
    );
  }
  valid(run: LearningRun): boolean {
    const lease = this.lease();
    return (
      this.get(run.runId)?.state === "running" &&
      this.generation(run.parentSessionId) === run.generation &&
      lease?.runId === run.runId &&
      lease.expiresAt > this.now()
    );
  }
  bindChild(runId: string, childSessionId: string, childTurnId: string): void {
    this.db
      .update(automationRuns)
      .set({ childSessionId, childTurnId })
      .where(
        and(
          eq(automationRuns.runId, runId),
          eq(automationRuns.state, "running"),
        ),
      )
      .run();
  }
  finish(
    runId: string,
    state: string,
    reason?: string,
    report?: unknown,
  ): void {
    if (report !== undefined) this.report(runId, report);
    this.db
      .update(automationRuns)
      .set({ state, reason: reason ?? null, endedAtMs: this.now() })
      .where(eq(automationRuns.runId, runId))
      .run();
    if (this.lease()?.runId === runId)
      this.db
        .delete(automationState)
        .where(eq(automationState.key, "lease"))
        .run();
  }
  report(runId: string, report: unknown): void {
    const previous = this.get(runId)?.reportJson;
    const value = {
      ...(previous ? (JSON.parse(previous) as object) : {}),
      ...(report as object),
    };
    this.db
      .update(automationRuns)
      .set({ reportJson: JSON.stringify(value) })
      .where(eq(automationRuns.runId, runId))
      .run();
  }
  journal(runId: string): LearningChange[] {
    return this.db
      .select()
      .from(automationChanges)
      .where(eq(automationChanges.runId, runId))
      .orderBy(
        asc(automationChanges.createdAtMs),
        asc(automationChanges.changeId),
      )
      .all();
  }
  intent(
    input: Omit<
      typeof automationChanges.$inferInsert,
      "changeId" | "createdAtMs" | "state"
    >,
  ): string {
    const changeId = randomUUID();
    this.db
      .insert(automationChanges)
      .values({ ...input, changeId, state: "intent", createdAtMs: this.now() })
      .run();
    return changeId;
  }
  changeState(changeId: string, state: string): void {
    this.db
      .update(automationChanges)
      .set({ state })
      .where(eq(automationChanges.changeId, changeId))
      .run();
  }
  interruptedIntents(): LearningChange[] {
    return this.db
      .select()
      .from(automationChanges)
      .where(sql`${automationChanges.state} IN ('intent', 'rollback_intent')`)
      .all();
  }
  pruneBeforeImages(): void {
    const keep = this.db
      .select({ id: automationRuns.runId })
      .from(automationRuns)
      .orderBy(desc(automationRuns.createdAtMs))
      .limit(RETAINED_CHANGE_RUNS)
      .all()
      .map((row) => row.id);
    if (keep.length < RETAINED_CHANGE_RUNS) return;
    const cutoff = this.db
      .select({ created: automationRuns.createdAtMs })
      .from(automationRuns)
      .where(eq(automationRuns.runId, keep.at(-1)!))
      .get()!.created;
    this.db
      .update(automationChanges)
      .set({ beforeText: null, afterText: null, state: "expired" })
      .where(
        and(
          sql`${automationChanges.createdAtMs} < ${cutoff}`,
          sql`${automationChanges.state} NOT IN ('intent', 'rollback_intent')`,
        ),
      )
      .run();
  }
  private lease(): { runId: string; expiresAt: number } | undefined {
    const row = this.db
      .select()
      .from(automationState)
      .where(eq(automationState.key, "lease"))
      .get();
    if (!row) return undefined;
    const value = JSON.parse(row.valueJson) as {
      runId: string;
      expiresAt: number;
    };
    if (typeof value.runId !== "string" || !Number.isFinite(value.expiresAt))
      throw new Error("Invalid automation lease");
    return value;
  }
}
