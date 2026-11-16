import { createHash } from "node:crypto";

import type {
  AnalysisProducerReceipt,
  AnalysisProducerReceiptDraft,
} from "./contracts.js";

type ReceiptWithoutDigest = Omit<AnalysisProducerReceiptDraft, "receiptSha256">;

export function createAnalysisReceiptDigest(
  receipt: ReceiptWithoutDigest | AnalysisProducerReceiptDraft | AnalysisProducerReceipt,
): string {
  const {
    receiptSha256: _receiptSha256,
    id: _id,
    hypothesisId: _hypothesisId,
    ingestedBySessionId: _ingestedBySessionId,
    ingestedAtMs: _ingestedAtMs,
    ...content
  } = receipt as AnalysisProducerReceipt & Record<string, unknown>;
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
