import type {
  AnalysisProducerReceiptDraft,
  IngestAnalysisRunInput,
} from "./contracts.js";
import { ingestAnalysisProducerRun } from "./ingest.js";

export type IngestHexCoreRunInput = Omit<IngestAnalysisRunInput, "producer">;

/** Ingests the stable HexCore Jobs v1 boundary without depending on editor internals. */
export function ingestHexCoreAnalysisRun(
  input: IngestHexCoreRunInput,
): Promise<AnalysisProducerReceiptDraft> {
  return ingestAnalysisProducerRun({ ...input, producer: "hexcore-job" });
}
