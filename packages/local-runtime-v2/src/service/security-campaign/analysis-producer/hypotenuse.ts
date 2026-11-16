import type {
  AnalysisProducerReceiptDraft,
  IngestAnalysisRunInput,
} from "./contracts.js";
import { ingestAnalysisProducerRun } from "./ingest.js";

export type IngestHypotenuseRunInput = Omit<
  IngestAnalysisRunInput,
  "producer"
>;

/**
 * Experimental Android adapter. It consumes only the Jobs v1 status/provenance
 * contract because Hypotenuse implementation details are intentionally unstable.
 */
export function ingestHypotenuseAnalysisRun(
  input: IngestHypotenuseRunInput,
): Promise<AnalysisProducerReceiptDraft> {
  return ingestAnalysisProducerRun({ ...input, producer: "hypotenuse-job" });
}
