import { createHash } from "node:crypto";

import type {
  ResearchScope,
  ResearchTarget,
  ResearchHypothesisFingerprint,
  ResearchHypothesisFingerprintInput,
} from "./contracts.js";

export function createResearchFingerprint(
  input: ResearchHypothesisFingerprintInput,
): ResearchHypothesisFingerprint {
  const canonical = {
    targetFamily: normalizeFingerprintField(input.targetFamily),
    attackerPosition: normalizeFingerprintField(input.attackerPosition),
    trustBoundary: normalizeFingerprintField(input.trustBoundary),
    primitive: normalizeFingerprintField(input.primitive),
    privilegedConsumer: normalizeFingerprintField(input.privilegedConsumer),
    lifecycle: normalizeFingerprintField(input.lifecycle),
    impact: normalizeFingerprintField(input.impact),
  };
  const key = createHash("sha256")
    .update(Object.values(canonical).join("\0"))
    .digest("hex");
  return { ...canonical, key };
}

function normalizeFingerprintField(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ");
}

export function createResearchFreezeDigest(
  target: ResearchTarget,
  scope: ResearchScope,
): string {
  return createHash("sha256")
    .update(canonicalJson({ target, scope }))
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
