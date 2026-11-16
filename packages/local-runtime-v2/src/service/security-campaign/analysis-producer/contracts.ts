export const ANALYSIS_PRODUCER_KINDS = ["hexcore-job", "hypotenuse-job"] as const;
export type AnalysisProducerKind = (typeof ANALYSIS_PRODUCER_KINDS)[number];

export type AnalysisProducerStatus = "ok" | "partial" | "failed" | "skipped";
export type AnalysisArtifactVerification = "runtime-verified" | "declared";
export type AnalysisArtifactRole =
  | "root-target"
  | "effective-input"
  | "output"
  | "job"
  | "status"
  | "provenance";

export interface AnalysisProducerIdentity {
  id: string;
  version: string;
  buildSha256?: string;
  details?: Record<string, string | number | boolean>;
}

export interface AnalysisReceiptArtifact {
  id: string;
  role: AnalysisArtifactRole;
  reference: string;
  sha256: string;
  bytes?: number;
  mediaType?: string;
  verification: AnalysisArtifactVerification;
}

export interface AnalysisDerivationEdge {
  outputArtifactId: string;
  inputArtifactIds: string[];
  command: string;
  status: AnalysisProducerStatus;
  stepIndex?: number;
  stepId?: string;
  configurationSha256?: string;
}

export interface AnalysisCoverage {
  complete: boolean;
  partialReasons: string[];
  totalSteps: number;
  okSteps: number;
  partialSteps: number;
  failedSteps: number;
  skippedSteps: number;
  materializedFunctions?: number;
  discoveredFunctions?: number;
  unsupportedCount?: number;
}

export interface AnalysisProducerReceiptDraft {
  schemaVersion: 1;
  producer: {
    kind: AnalysisProducerKind;
    contract: "analysis-jobs-v1";
    experimental: boolean;
    identities: AnalysisProducerIdentity[];
  };
  status: AnalysisProducerStatus;
  rootTarget: AnalysisReceiptArtifact;
  artifacts: AnalysisReceiptArtifact[];
  derivations: AnalysisDerivationEdge[];
  coverage: AnalysisCoverage;
  source: {
    statusArtifactId: string;
    provenanceArtifactId: string;
    jobArtifactId?: string;
    executionId?: string;
    sessionId?: string;
    generation?: number;
  };
  warnings: string[];
  receiptSha256: string;
}

export interface AnalysisProducerReceipt extends AnalysisProducerReceiptDraft {
  id: string;
  hypothesisId: string;
  ingestedBySessionId: string;
  ingestedAtMs: number;
}

export interface IngestAnalysisRunInput {
  producer: AnalysisProducerKind;
  statusPath: string;
  localRoots: readonly string[];
}
