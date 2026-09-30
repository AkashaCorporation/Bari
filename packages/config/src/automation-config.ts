/** Local automatic workflows. Manual skill invocation remains independent. */
export interface BariAutomationConfig {
  enabled: boolean;
  composeNext: boolean;
  dream: boolean;
  distill: boolean;
  idleDelayMs: number;
  cooldownMs: number;
  minAssistantMessages: number;
  maxRunsPerDay: number;
  maxEvidenceBytes: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

export const DEFAULT_BARI_AUTOMATION: Readonly<BariAutomationConfig> =
  Object.freeze({
    enabled: true,
    composeNext: true,
    dream: true,
    distill: true,
    idleDelayMs: 30_000,
    cooldownMs: 60 * 60_000,
    minAssistantMessages: 6,
    maxRunsPerDay: 4,
    maxEvidenceBytes: 24 * 1024,
    maxOutputTokens: 2048,
    timeoutMs: 90_000,
  });

export function parseBariAutomationConfig(
  value: unknown,
): BariAutomationConfig {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  // A malformed explicit switch must never turn paid automatic work on.
  const flag = (
    key: "enabled" | "composeNext" | "dream" | "distill",
  ): boolean =>
    raw[key] === undefined ? DEFAULT_BARI_AUTOMATION[key] : raw[key] === true;
  const bounded = (
    key: keyof BariAutomationConfig,
    min: number,
    max: number,
  ): number => {
    const candidate = raw[key];
    return typeof candidate === "number" && Number.isSafeInteger(candidate)
      ? Math.min(max, Math.max(min, candidate))
      : (DEFAULT_BARI_AUTOMATION[key] as number);
  };
  return {
    enabled:
      value !== undefined &&
      (value === null || typeof value !== "object" || Array.isArray(value))
        ? false
        : flag("enabled"),
    composeNext: flag("composeNext"),
    dream: flag("dream"),
    distill: flag("distill"),
    idleDelayMs: bounded("idleDelayMs", 1_000, 10 * 60_000),
    cooldownMs: bounded("cooldownMs", 60_000, 7 * 24 * 60 * 60_000),
    minAssistantMessages: bounded("minAssistantMessages", 2, 100),
    maxRunsPerDay: bounded("maxRunsPerDay", 0, 24),
    maxEvidenceBytes: bounded("maxEvidenceBytes", 1024, 128 * 1024),
    maxOutputTokens: bounded("maxOutputTokens", 256, 8192),
    timeoutMs: bounded("timeoutMs", 5_000, 5 * 60_000),
  };
}
