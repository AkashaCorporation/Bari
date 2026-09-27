import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { PiLLMRequestObserver } from '@bari/agent-core/pi-turn-runner';
import {
  REQUEST_USAGE_FIELDS,
  sumRequestUsageBuckets,
  type RequestUsageBucket,
  type SessionRequestAccounting,
} from '@bari/shared/request-usage';
import type { AppDb } from '../../../infra/db/client.js';
import { llmRequests, requestAccountingState } from '../../../infra/db/schema/llm-requests.js';
import { sessions } from '../../../infra/db/schema/sessions.js';
import { tokenUsage } from '../../../infra/db/schema/usage.js';
import type { SessionUsageCommitSignal } from './commit-signal.js';

/** Numeric local accounting only. Independent of telemetry upload preferences. */
export class RequestUsageLedger {
  private degraded = false;

  constructor(
    private readonly db: AppDb,
    private readonly commits: SessionUsageCommitSignal,
    private readonly options: { failureMarkerPath?: string } = {},
  ) {}

  readonly observe: PiLLMRequestObserver = (info) => {
    const id = randomUUID();
    let ancestry: string[] = [];
    let stored = false;
    try {
      const attribution = this.attribution(info.sessionId);
      ancestry = attribution.ancestors;
      this.write(() =>
        this.db
          .insert(llmRequests)
          .values({
            requestId: id,
            sessionId: info.sessionId,
            turnId: info.turnId,
            agentName: attribution.agentName,
            rootSessionId: ancestry.at(-1) ?? info.sessionId,
            ancestryJson: JSON.stringify(ancestry),
            attributionIncomplete: Number(attribution.incomplete),
            category: attribution.learning ? 'learning' : 'agent',
            provider: info.provider,
            model: info.model,
            caller: info.caller,
            scope: info.scope ?? 'agent',
            startedAtMs: info.startedAtMs,
          })
          .run(),
      );
      stored = true;
    } catch {
      this.markDegraded();
    }
    this.notify(info.sessionId, ancestry);
    let settled = false;
    return (result) => {
      if (settled) return;
      settled = true;
      if (!stored) return;
      try {
        const usage = Object.fromEntries(
          REQUEST_USAGE_FIELDS.flatMap((field) => {
            const value = result.usage?.[field];
            return typeof value === 'number' &&
              Number.isFinite(value) &&
              value >= 0 &&
              (field === 'costUsd' || Number.isSafeInteger(value))
              ? [[field, value]]
              : [];
          }),
        );
        let usageStatus = result.usageStatus ?? 'missing';
        if (
          usageStatus === 'reported' &&
          (usage.totalTokens === undefined ||
            usage.inputTokens === undefined ||
            usage.outputTokens === undefined)
        ) {
          usageStatus = Object.keys(usage).length ? 'partial' : 'missing';
        }
        this.write(() =>
          this.db
            .update(llmRequests)
            .set({
              ...usage,
              endedAtMs: result.endedAtMs,
              outcome: result.outcome ?? 'error',
              usageStatus,
            })
            .where(eq(llmRequests.requestId, id))
            .run(),
        );
      } catch {
        this.markDegraded();
      }
      this.notify(info.sessionId, ancestry);
    };
  };

  read(sessionId: string, range: { from?: number; to?: number } = {}): SessionRequestAccounting {
    const epoch = this.db
      .select()
      .from(requestAccountingState)
      .where(eq(requestAccountingState.singleton, 1))
      .get();
    if (!epoch) throw new Error('Request accounting epoch is unavailable');
    // Ancestry is captured at request start, so a later reparent cannot move spend.
    const belongs = sql`(${llmRequests.sessionId} = ${sessionId} OR EXISTS
      (SELECT 1 FROM json_each(${llmRequests.ancestryJson}) WHERE value = ${sessionId}))`;
    const totals = Object.fromEntries(
      REQUEST_USAGE_FIELDS.map((field) => [field, sql<number | null>`sum(${llmRequests[field]})`]),
    );
    const rows = this.db
      .select({
        sessionId: llmRequests.sessionId,
        agentName: llmRequests.agentName,
        category: llmRequests.category,
        scope: llmRequests.scope,
        ...totals,
        requests: sql<number>`count(*)`.mapWith(Number),
        unknownRequests:
          sql<number>`sum(case when ${llmRequests.usageStatus} <> 'reported' then 1 else 0 end)`.mapWith(
            Number,
          ),
        pendingRequests:
          sql<number>`sum(case when ${llmRequests.outcome} = 'pending' then 1 else 0 end)`.mapWith(
            Number,
          ),
        attributionIncomplete: sql<number>`max(${llmRequests.attributionIncomplete})`.mapWith(
          Number,
        ),
      })
      .from(llmRequests)
      .where(
        and(
          belongs,
          range.from === undefined ? undefined : gte(llmRequests.startedAtMs, range.from),
          range.to === undefined ? undefined : lte(llmRequests.startedAtMs, range.to),
        ),
      )
      .groupBy(
        llmRequests.sessionId,
        llmRequests.agentName,
        llmRequests.category,
        llmRequests.scope,
      )
      .all();
    const scoped = rows.map((row) => ({
      sessionId: row.sessionId,
      agentName: row.agentName,
      scope: row.scope,
      category: row.category === 'learning' ? ('learning' as const) : ('agent' as const),
      usage: {
        requests: row.requests,
        unknownRequests: row.unknownRequests,
        pendingRequests: row.pendingRequests,
        ...Object.fromEntries(
          REQUEST_USAGE_FIELDS.flatMap((field) => {
            const value = Reflect.get(row, field);
            return typeof value === 'number' && Number.isFinite(value) ? [[field, value]] : [];
          }),
        ),
      } satisfies RequestUsageBucket,
    }));
    const grouped = new Map<string, SessionRequestAccounting['byAgent'][number]>();
    for (const row of scoped) {
      const key = JSON.stringify([row.sessionId, row.agentName, row.category]);
      const previous = grouped.get(key);
      grouped.set(key, {
        sessionId: row.sessionId,
        agentName: row.agentName,
        category: row.category,
        usage: previous ? sumRequestUsageBuckets([previous.usage, row.usage]) : row.usage,
      });
    }
    const byAgent = [...grouped.values()];
    const session = this.db
      .select({ created: sessions.createdAtMs })
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId))
      .get();
    const hasLegacy =
      this.db
        .select({ id: tokenUsage.id })
        .from(tokenUsage)
        .where(and(eq(tokenUsage.sessionId, sessionId), lte(tokenUsage.id, epoch.legacyLastId)))
        .limit(1)
        .get() !== undefined;
    return {
      coverage: 'recorded',
      sinceMs: epoch.sinceMs,
      sessionId,
      byAgent,
      own: sumRequestUsageBuckets(
        byAgent
          .filter((row) => row.sessionId === sessionId && row.category !== 'learning')
          .map((row) => row.usage),
      ),
      agents: sumRequestUsageBuckets(
        byAgent
          .filter((row) => row.sessionId !== sessionId && row.category !== 'learning')
          .map((row) => row.usage),
      ),
      maintenance: sumRequestUsageBuckets(
        byAgent.filter((row) => row.category === 'learning').map((row) => row.usage),
      ),
      total: sumRequestUsageBuckets(byAgent.map((row) => row.usage)),
      auxiliary: {
        compaction: sumRequestUsageBuckets(
          scoped.filter((row) => row.scope === 'compaction').map((row) => row.usage),
        ),
        title: sumRequestUsageBuckets(
          scoped.filter((row) => row.scope === 'title').map((row) => row.usage),
        ),
      },
      legacyUnverified: hasLegacy || !session?.created || session.created < epoch.sinceMs,
      accountingDegraded:
        this.degraded ||
        epoch.degraded !== 0 ||
        Boolean(this.options.failureMarkerPath && existsSync(this.options.failureMarkerPath)) ||
        rows.some((row) => row.attributionIncomplete !== 0),
    };
  }

  private attribution(sessionId: string) {
    const ancestors: string[] = [];
    const seen = new Set([sessionId]);
    let current = this.db.select().from(sessions).where(eq(sessions.sessionId, sessionId)).get();
    const agentName = current?.agentName ?? 'unknown';
    let learning = current?.purpose?.startsWith('learning:') === true;
    let incomplete = !current;
    for (
      let depth = 0;
      current?.parentSessionId &&
      (current.sessionKind === 'task' || current.sessionKind === 'peek');
      depth++
    ) {
      const parentId = current.parentSessionId;
      if (depth >= 64 || seen.has(parentId)) {
        incomplete = true;
        break;
      }
      seen.add(parentId);
      ancestors.push(parentId);
      current = this.db.select().from(sessions).where(eq(sessions.sessionId, parentId)).get();
      learning ||= current?.purpose?.startsWith('learning:') === true;
      if (!current) {
        incomplete = true;
        break;
      }
    }
    return { ancestors, agentName, learning, incomplete };
  }

  private notify(sessionId: string, ancestors: readonly string[]): void {
    for (const id of [sessionId, ...ancestors]) this.commits.publish(id);
  }

  private write(work: () => unknown): void {
    // Observation must not impose the connection's five-second native lock wait.
    const previous = this.db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`).timeout;
    try {
      this.db.run(sql`PRAGMA busy_timeout = 0`);
      work();
      if (this.degraded) this.db.update(requestAccountingState).set({ degraded: 1 }).run();
    } finally {
      this.db.run(sql.raw(`PRAGMA busy_timeout = ${previous}`));
    }
  }

  private markDegraded(): void {
    this.degraded = true;
    if (this.options.failureMarkerPath) {
      // Independent of SQLite writer locks. Exclusive creation never follows an
      // existing link and the marker contains no session or request content.
      try {
        writeFileSync(this.options.failureMarkerPath, '1\n', { flag: 'wx', mode: 0o600 });
      } catch {
        /* existing marker or unavailable filesystem; live state stays degraded */
      }
    }
    try {
      this.write(() => this.db.update(requestAccountingState).set({ degraded: 1 }).run());
    } catch {
      /* surfaced in the live summary */
    }
  }
}
