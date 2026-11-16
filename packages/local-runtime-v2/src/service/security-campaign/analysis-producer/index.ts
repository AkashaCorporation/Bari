import type {
  AnalysisProducerReceiptDraft,
  IngestAnalysisRunInput,
} from "./contracts.js";
import { ingestHexCoreAnalysisRun } from "./hexcore.js";
import { ingestHypotenuseAnalysisRun } from "./hypotenuse.js";

export type {
  AnalysisArtifactRole,
  AnalysisArtifactVerification,
  AnalysisCoverage,
  AnalysisDerivationEdge,
  AnalysisProducerIdentity,
  AnalysisProducerKind,
  AnalysisProducerReceipt,
  AnalysisProducerReceiptDraft,
  AnalysisProducerStatus,
  AnalysisReceiptArtifact,
  IngestAnalysisRunInput,
} from "./contracts.js";

/** Dispatches by explicit producer while preserving one canonical Jobs contract. */
export function ingestAnalysisRun(
  input: IngestAnalysisRunInput,
): Promise<AnalysisProducerReceiptDraft> {
  return input.producer === "hexcore-job"
    ? ingestHexCoreAnalysisRun(input)
    : ingestHypotenuseAnalysisRun(input);
}
