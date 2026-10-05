import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { normalizeReportedRequestUsage, sumRequestUsageBuckets } from '@bari/shared/request-usage';
import { DatabaseClient } from '../packages/local-runtime-v2/src/infra/db/client.js';
import { runMigrations } from '../packages/local-runtime-v2/src/infra/db/migrate.js';
import { ALL_MIGRATIONS } from '../packages/local-runtime-v2/src/infra/db/migrations.js';
import { REQUEST_ACCOUNTING_MIGRATION_VERSION } from '../packages/local-runtime-v2/src/infra/db/migrations/session/migration-1000-request-accounting.js';
import { assertDatabaseSchemaConsistent } from '../packages/local-runtime-v2/src/infra/db/schema-consistency.js';
import { sessions } from '../packages/local-runtime-v2/src/infra/db/schema/sessions.js';
import { tokenUsage } from '../packages/local-runtime-v2/src/infra/db/schema/usage.js';
import {
  llmRequests,
  requestAccountingState,
} from '../packages/local-runtime-v2/src/infra/db/schema/llm-requests.js';
import { RequestUsageLedger } from '../packages/local-runtime-v2/src/service/session-system/usage/request-ledger.js';
import { createSessionUsageCommitSignal } from '../packages/local-runtime-v2/src/service/session-system/usage/commit-signal.js';
import { summarizeCommittedPiGoalUsage } from '../packages/local-runtime-v2/src/service/session-system/usage/pi-usage.js';

const cleanup: Array<() => Promise<void> | void> = [];
// The fixture represents a current database. A default that stopped at an older
// version would exercise a schema the product no longer ships, which is how a
// settle write against a missing column would hide as accounting degradation.
const LATEST_MIGRATION_VERSION = Math.max(...ALL_MIGRATIONS.map((entry) => entry.version));
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(version = LATEST_MIGRATION_VERSION) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bari-request-accounting-'));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const client = new DatabaseClient({ dataDir });
  cleanup.push(() => client.close());
  runMigrations(
    client.rawDb,
    ALL_MIGRATIONS.filter((entry) => entry.version <= version),
  );
  const commits = createSessionUsageCommitSignal();
  const notifications: string[] = [];
  commits.subscribe((id) => notifications.push(id));
  const ledgerOptions = {
    failureMarkerPath: join(dataDir, 'v2', '.request-accounting-incomplete'),
  };
  const ledger = new RequestUsageLedger(client.db, commits, ledgerOptions);
  function seed(
    id: string,
    parent?: string,
    purpose?: string,
    kind = parent ? 'task' : 'conversation',
  ) {
    client.db
      .insert(sessions)
      .values({
        sessionId: id,
        recordJson: '{}',
        updatedAtMs: Date.now(),
        createdAtMs: Date.now(),
        columnarVersion: 3,
        agentName: id,
        parentSessionId: parent,
        sessionKind: kind,
        sessionType: parent ? 'branch' : 'root',
        purpose,
        workspaceDir: dataDir,
      })
      .run();
  }
  function start(sessionId: string, scope: 'agent' | 'compaction' | 'title' = 'agent') {
    return ledger.observe({
      sessionId,
      turnId: `turn-${sessionId}`,
      startedAtMs: Date.now(),
      provider: 'fixture',
      model: 'fixture',
      caller: 'chat',
      scope,
    })!;
  }
  function record(id: string, tokens: number, scope: 'agent' | 'compaction' | 'title' = 'agent') {
    start(
      id,
      scope,
    )({
      endedAtMs: Date.now(),
      cacheOutcome: 'no_read',
      outcome: 'success',
      usageStatus: 'reported',
      usage: { inputTokens: tokens, outputTokens: 0, totalTokens: tokens },
    });
  }
  return { client, ledger, seed, start, record, notifications, commits, dataDir, ledgerOptions };
}

describe('physical request accounting', () => {
  it('migrates the upstream schema into Bari accounting without reinterpreting or deleting legacy rows', async () => {
    const f = await fixture(36);
    assertDatabaseSchemaConsistent(f.client.rawDb);
    f.client.db
      .insert(tokenUsage)
      .values({
        sessionId: 'old',
        agentName: 'old',
        frameworkType: 'pi-agent',
        timestamp: 1,
        inputTokens: 10,
        outputTokens: 2,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
      .run();
    runMigrations(f.client.rawDb, ALL_MIGRATIONS);
    assertDatabaseSchemaConsistent(f.client.rawDb);
    expect(f.client.db.select().from(tokenUsage).all()).toMatchObject([
      { inputTokens: 10, outputTokens: 2 },
    ]);
    expect(f.client.db.select().from(requestAccountingState).get()?.legacyLastId).toBe(1);
    f.seed('old');
    f.record('old', 7);
    expect(f.ledger.read('old').total.totalTokens).toBe(7);
    expect(f.ledger.read('old').legacyUnverified).toBe(true);
    runMigrations(f.client.rawDb, ALL_MIGRATIONS);
    expect(f.ledger.read('old').total.requests).toBe(1);
  });

  it('separates own, nested agents and learning with each physical call counted once', async () => {
    const f = await fixture();
    f.seed('root');
    f.seed('june', 'root');
    f.seed('worker', 'june');
    f.seed('learning', 'root', 'learning:dream');
    f.seed('unrelated');
    f.record('root', 100);
    f.record('june', 40);
    f.record('worker', 10);
    f.record('learning', 20);
    f.record('unrelated', 900);
    const view = f.ledger.read('root');
    expect([
      view.own.totalTokens,
      view.agents.totalTokens,
      view.maintenance.totalTokens,
      view.total.totalTokens,
    ]).toEqual([100, 50, 20, 170]);
    expect(view.total.requests).toBe(4);
    expect(f.notifications.filter((id) => id === 'root')).toHaveLength(8);
    expect(f.ledger.read('june').total.totalTokens).toBe(50);
  });

  it('keeps pending, missing and valid zero usage distinct across restart', async () => {
    const f = await fixture();
    f.seed('root');
    f.start('root');
    f.start('root')({
      endedAtMs: Date.now(),
      cacheOutcome: 'telemetry_unknown',
      outcome: 'error',
      usageStatus: 'missing',
    });
    f.record('root', 0);
    f.client.close();
    const reopened = new DatabaseClient({ dataDir: f.dataDir });
    cleanup.push(() => reopened.close());
    const view = new RequestUsageLedger(reopened.db, f.commits).read('root');
    expect(view.total).toMatchObject({
      requests: 3,
      unknownRequests: 2,
      pendingRequests: 1,
      totalTokens: 0,
    });
    expect(
      reopened.db
        .select()
        .from(llmRequests)
        .all()
        .map((row) => row.usageStatus)
        .sort(),
    ).toEqual(['missing', 'pending', 'reported']);
  });

  it('does not replay settlements and counts retries/compactions as separate requests', async () => {
    const f = await fixture();
    f.seed('root');
    const settle = f.start('root');
    const final = {
      endedAtMs: Date.now(),
      cacheOutcome: 'no_read' as const,
      outcome: 'success' as const,
      usageStatus: 'reported' as const,
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    };
    settle(final);
    settle(final);
    f.record('root', 3, 'compaction');
    f.record('root', 1, 'title');
    expect(f.ledger.read('root').total).toMatchObject({ totalTokens: 16, requests: 3 });
    expect(f.ledger.read('root').auxiliary).toMatchObject({
      compaction: { totalTokens: 3 },
      title: { totalTokens: 1 },
    });
    expect(f.ledger.read('root').byAgent).toHaveLength(1);
  });

  it('preserves recorded attribution after task reparenting and excludes conversation forks', async () => {
    const f = await fixture();
    f.seed('root');
    f.seed('other');
    f.seed('june', 'root');
    f.seed('fork', 'root', undefined, 'conversation');
    f.record('june', 11);
    f.record('fork', 900);
    f.client.db
      .update(sessions)
      .set({ parentSessionId: 'other' })
      .where(eq(sessions.sessionId, 'june'))
      .run();
    f.record('june', 13);
    expect(f.ledger.read('root').total.totalTokens).toBe(11);
    expect(f.ledger.read('other').total.totalTokens).toBe(13);
    expect(f.ledger.read('june').total.totalTokens).toBe(24);
  });

  it('bounds ancestry cycles and exposes degraded attribution', async () => {
    const f = await fixture();
    f.seed('a', 'b');
    f.seed('b', 'a');
    f.record('a', 5);
    expect(f.ledger.read('a')).toMatchObject({
      accountingDegraded: true,
      total: { requests: 1, totalTokens: 5 },
    });
  });

  it('keeps accounting failures visible without blocking model work on a foreign writer', async () => {
    const f = await fixture();
    f.seed('root');
    const holder = new DatabaseClient({ dataDir: f.dataDir });
    cleanup.push(() => holder.close());
    holder.rawDb.exec('BEGIN IMMEDIATE');
    const started = performance.now();
    f.start('root');
    expect(performance.now() - started).toBeLessThan(500);
    holder.rawDb.exec('ROLLBACK');
    expect(f.ledger.read('root').accountingDegraded).toBe(true);
    // Reopen BEFORE a later successful ledger write can persist the SQL flag.
    const afterLoss = new DatabaseClient({ dataDir: f.dataDir });
    cleanup.push(() => afterLoss.close());
    expect(
      new RequestUsageLedger(afterLoss.db, f.commits, f.ledgerOptions).read('root')
        .accountingDegraded,
    ).toBe(true);
    f.record('root', 4);
    const reopened = new RequestUsageLedger(f.client.db, f.commits);
    expect(reopened.read('root')).toMatchObject({
      accountingDegraded: true,
      total: { requests: 1, totalTokens: 4 },
    });
  });

  it('attributes nested learning work to learning without counting it twice', async () => {
    const f = await fixture();
    f.seed('root');
    f.seed('dream', 'root', 'learning:dream');
    f.seed('nested', 'dream');
    f.record('dream', 5);
    f.record('nested', 7, 'compaction');
    expect(f.ledger.read('root')).toMatchObject({
      agents: { requests: 0 },
      maintenance: { totalTokens: 12 },
      total: { totalTokens: 12 },
      auxiliary: { compaction: { totalTokens: 7 } },
    });
  });
});

describe('reported usage normalization', () => {
  it('keeps explicitly missing provider telemetry incomplete in Goal accounting too', () => {
    expect(summarizeCommittedPiGoalUsage([{ role: 'assistant', stopReason: 'aborted', usage: { reported: true, input: 3, output: 0 } }]))
      .toEqual({ tokens: 3, incomplete: true });
    expect(summarizeCommittedPiGoalUsage([{ role: 'assistant', usage: { reported: false, input: 0, output: 0 } }]))
      .toEqual({ tokens: 0, incomplete: true });
    expect(summarizeCommittedPiGoalUsage([{ role: 'assistant', usage: { reported: true, reportedFields: ['input'], input: 3, output: 0 } }]))
      .toEqual({ tokens: 3, incomplete: true });
  });
  it('counts cache once and does not add reasoning to output a second time', () => {
    expect(
      normalizeReportedRequestUsage(
        { input: 10, output: 20, reasoning: 7, cacheRead: 30, cacheWrite: 4 },
        'success',
      ),
    ).toEqual({
      status: 'reported',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        reasoningTokens: 7,
        cacheReadTokens: 30,
        cacheWriteTokens: 4,
        totalTokens: 64,
      },
    });
  });
  it('does not turn a failed zero-initialized adapter response into a free request', () => {
    expect(
      normalizeReportedRequestUsage(
        { input: 0, output: 0, totalTokens: 0, cost: { total: 0 } },
        'error',
      ),
    ).toEqual({ status: 'missing', usage: {} });
    expect(
      normalizeReportedRequestUsage(
        { input: 0, output: 0, totalTokens: 0, reported: true },
        'success',
      ).status,
    ).toBe('reported');
    expect(
      normalizeReportedRequestUsage({ input: 0, output: 0, totalTokens: 0 }, 'success').status,
    ).toBe('missing');
  });
  it.each(['abort', 'error'] as const)(
    'keeps a positive but interrupted %s usage snapshot partial',
    (outcome) => {
      expect(
        normalizeReportedRequestUsage(
          { reported: true, input: 10, output: 0, totalTokens: 10 },
          outcome,
        ),
      ).toEqual({
        status: 'partial',
        usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
      });
    },
  );
  it('does not manufacture omitted buckets from adapter defaults', () => {
    expect(
      normalizeReportedRequestUsage(
        { reported: true, reportedFields: ['output'], input: 0, output: 2, totalTokens: 2 },
        'success',
      ),
    ).toEqual({ status: 'partial', usage: { outputTokens: 2 } });
  });
  it.each([-1, NaN, Infinity, 1.5, '12', Number.MAX_SAFE_INTEGER + 1])(
    'keeps invalid counters explicit: %s',
    (input) => {
      expect(normalizeReportedRequestUsage({ input, output: 2 }, 'success')).toEqual({
        status: 'invalid',
        usage: { outputTokens: 2 },
      });
    },
  );
  it('keeps a wholly unknown group unknown when combined with unused groups', () => {
    expect(
      sumRequestUsageBuckets([
        { requests: 0, unknownRequests: 0, pendingRequests: 0, totalTokens: 0 },
        { requests: 1, unknownRequests: 1, pendingRequests: 1 },
      ]).totalTokens,
    ).toBeUndefined();
  });
});

describe('settled attempt reasons', () => {
  it('keeps why an attempt failed across a restart and counts failures apart', async () => {
    const f = await fixture();
    f.seed('root');
    f.start('root')({
      endedAtMs: Date.now(),
      cacheOutcome: 'telemetry_unknown',
      outcome: 'error',
      settleReason: 'provider-error',
      usageStatus: 'missing',
    });
    f.start('root')({
      endedAtMs: Date.now(),
      cacheOutcome: 'telemetry_unknown',
      outcome: 'abort',
      settleReason: 'aborted',
      usageStatus: 'missing',
    });
    f.client.close();

    const reopened = new DatabaseClient({ dataDir: f.dataDir });
    cleanup.push(() => reopened.close());
    const reasons = reopened.db
      .select()
      .from(llmRequests)
      .all()
      .map((row) => row.settleReason)
      .sort();
    expect(reasons).toEqual(['aborted', 'provider-error']);

    const view = new RequestUsageLedger(reopened.db, f.commits).read('root');
    expect(view.total.failedRequests).toBe(1);
    expect(view.total.abortedRequests).toBe(1);
  });

  it('refuses to store anything outside the closed reason vocabulary', async () => {
    const f = await fixture();
    f.seed('root');
    // An untyped producer handing over provider text must not reach the ledger:
    // the column promises no error bodies, headers or credentials.
    f.start('root')({
      endedAtMs: Date.now(),
      cacheOutcome: 'telemetry_unknown',
      outcome: 'error',
      settleReason: 'HTTP 429 rate limit exceeded for key sk-secret-value' as never,
      usageStatus: 'missing',
    });
    const rows = f.client.db.select().from(llmRequests).all();
    expect(rows.map((row) => row.settleReason)).toEqual([null]);
    expect(JSON.stringify(rows)).not.toContain('sk-secret-value');
  });

  it('leaves the failure counters absent when no bucket reports them', () => {
    const summed = sumRequestUsageBuckets([
      { requests: 2, unknownRequests: 0, pendingRequests: 0 },
    ]);
    expect(summed.failedRequests).toBeUndefined();
    expect(summed.abortedRequests).toBeUndefined();
  });
});