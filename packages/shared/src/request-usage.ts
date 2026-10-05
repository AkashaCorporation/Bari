/** Provider-reported counters. Reasoning is a subset of output, never added again. */
export interface ReportedRequestUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  /** Optional model-price estimate, not the provider invoice. */
  costUsd?: number;
}

export type RequestUsageStatus = 'reported' | 'partial' | 'missing' | 'invalid';
export type RequestOutcome = 'success' | 'error' | 'abort';

/**
 * Why a physical request settled the way it did.
 *
 * Deliberately a closed vocabulary rather than free text. The durable ledger
 * promises no prompt, content, error bodies, headers or credentials, and a raw
 * provider error string would break that promise while adding little: the
 * classification is what makes a settled attempt diagnosable after the fact.
 * `isRequestSettleReason` is the guard that keeps the column to this set.
 */
export const REQUEST_SETTLE_REASONS = [
  /** The provider returned a final assistant message. */
  'completed',
  /** Cancelled by the user or by the runtime. */
  'aborted',
  /** The provider adapter reported a transport or protocol error. */
  'provider-error',
  /** The stream ended with an error stop reason. */
  'stop-error',
  /** An exception escaped the request. */
  'thrown',
  /** No final message and no other signal to classify it. */
  'no-response',
] as const;

export type RequestSettleReason = (typeof REQUEST_SETTLE_REASONS)[number];

export function isRequestSettleReason(value: unknown): value is RequestSettleReason {
  return (
    typeof value === 'string' && (REQUEST_SETTLE_REASONS as readonly string[]).includes(value)
  );
}


export interface RequestUsageBucket extends ReportedRequestUsage {
  requests: number;
  unknownRequests: number;
  pendingRequests: number;
  /** Settled attempts whose outcome was `error`; the reason is in the ledger row. */
  failedRequests?: number;
  /** Settled attempts whose outcome was `abort`. */
  abortedRequests?: number;
}

export interface SessionRequestAccounting {
  /** Physical requests observed by this runtime, not a reconstructed provider bill. */
  coverage: 'recorded';
  sinceMs: number;
  sessionId: string;
  own: RequestUsageBucket;
  agents: RequestUsageBucket;
  maintenance: RequestUsageBucket;
  /** Auxiliary subsets already included in own/agents/maintenance, never added again. */
  auxiliary?: { compaction: RequestUsageBucket; title: RequestUsageBucket };
  total: RequestUsageBucket;
  byAgent: Array<{
    sessionId: string;
    agentName: string;
    category: 'agent' | 'learning';
    usage: RequestUsageBucket;
  }>;
  legacyUnverified: boolean;
  accountingDegraded: boolean;
}

export const REQUEST_USAGE_FIELDS = [
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'totalTokens',
  'costUsd',
] as const;

/** Project numeric facts only; no prompt, content, errors, headers or credentials. */
export function normalizeReportedRequestUsage(
  raw: unknown,
  outcome: RequestOutcome,
): {
  usage: ReportedRequestUsage;
  status: RequestUsageStatus;
} {
  if (!raw || typeof raw !== 'object') return { usage: {}, status: 'missing' };
  const source = raw as Record<string, unknown>;
  if (source.reported === false) return { usage: {}, status: 'missing' };
  const present = Array.isArray(source.reportedFields) ? new Set(source.reportedFields) : undefined;
  const usage: ReportedRequestUsage = {};
  let invalid = false;
  for (const [key, field] of [
    ['input', 'inputTokens'],
    ['output', 'outputTokens'],
    ['reasoning', 'reasoningTokens'],
    ['cacheRead', 'cacheReadTokens'],
    ['cacheWrite', 'cacheWriteTokens'],
    ['totalTokens', 'totalTokens'],
  ] as const) {
    if (present && !present.has(key)) continue;
    const value = source[key];
    if (value === undefined) continue;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
      usage[field] = value;
    else invalid = true;
  }
  const cost = (source.cost as { total?: unknown } | undefined)?.total;
  if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) usage.costUsd = cost;
  const anyPositive = Object.values(usage).some((value) => value > 0);
  // Adapters often initialize a zero-filled usage object before a failed stream.
  if (!anyPositive && source.reported !== true)
    return { usage: {}, status: invalid ? 'invalid' : 'missing' };
  if (
    usage.totalTokens === undefined &&
    [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens].every(
      (value) => value !== undefined,
    )
  ) {
    const sum =
      usage.inputTokens! + usage.outputTokens! + usage.cacheReadTokens! + usage.cacheWriteTokens!;
    if (Number.isSafeInteger(sum)) usage.totalTokens = sum;
    else invalid = true;
  }
  const known =
    usage.totalTokens !== undefined &&
    usage.inputTokens !== undefined &&
    usage.outputTokens !== undefined;
  return {
    usage,
    status: invalid
      ? 'invalid'
      : known && outcome === 'success'
        ? 'reported'
        : Object.keys(usage).length
          ? 'partial'
          : 'missing',
  };
}

export function sumRequestUsageBuckets(buckets: readonly RequestUsageBucket[]): RequestUsageBucket {
  const active = buckets.filter((bucket) => bucket.requests > 0);
  const result: RequestUsageBucket = {
    requests: active.reduce((sum, item) => sum + item.requests, 0),
    unknownRequests: active.reduce((sum, item) => sum + item.unknownRequests, 0),
    pendingRequests: active.reduce((sum, item) => sum + item.pendingRequests, 0),
  };
  for (const field of REQUEST_USAGE_FIELDS) {
    const known = active
      .map((item) => item[field])
      .filter((value): value is number => value !== undefined);
    if (known.length || !active.length) {
      const sum = known.reduce((total, value) => total + value, 0);
      if (Number.isFinite(sum) && (field === 'costUsd' || Number.isSafeInteger(sum)))
        result[field] = sum;
      else result.unknownRequests = Math.max(1, result.unknownRequests);
    }
  }
  // Counters that only some producers report stay absent when nobody reports
  // them, instead of aggregating into a fabricated zero.
  for (const field of ['failedRequests', 'abortedRequests'] as const) {
    const known = active
      .map((item) => item[field])
      .filter((value): value is number => value !== undefined);
    if (known.length) result[field] = known.reduce((total, value) => total + value, 0);
  }
  return result;
}
