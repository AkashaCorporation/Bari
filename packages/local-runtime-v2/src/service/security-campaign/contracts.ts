export const RESEARCH_TARGET_KINDS = [
  "source",
  "application",
  "firmware",
  "binary",
  "service",
  "mixed",
] as const;

export type ResearchTargetKind = (typeof RESEARCH_TARGET_KINDS)[number];

export const RESEARCH_EVIDENCE_KINDS = [
  "original-artifact",
  "derived-artifact",
  "analysis-artifact",
  "source-reference",
  "runtime-observation",
  "external-reference",
  "inference",
] as const;

export type ResearchEvidenceKind = (typeof RESEARCH_EVIDENCE_KINDS)[number];

export const RESEARCH_EVIDENCE_SUPPORTS = [
  "exact-target",
  "analysis-run",
  "attacker-position",
  "controlled-input",
  "transformations",
  "privileged-consumer",
  "constraints-protections",
  "realized-effect",
  "negative-control",
  "reproduction",
  "duplicate-status",
  "affected-scope",
] as const;

export type ResearchEvidenceSupport =
  (typeof RESEARCH_EVIDENCE_SUPPORTS)[number];

export const RESEARCH_HYPOTHESIS_STATUSES = [
  "lead",
  "candidate",
  "validated-condition",
  "demonstrated-impact",
  "reportable",
  "duplicate-or-known",
  "rejected",
  "unknown",
] as const;

export type ResearchHypothesisStatus =
  (typeof RESEARCH_HYPOTHESIS_STATUSES)[number];

export const RESEARCH_EXPERIMENT_OUTCOMES = [
  "confirmed",
  "not-reproduced",
  "inconclusive",
] as const;

export type ResearchExperimentOutcome =
  (typeof RESEARCH_EXPERIMENT_OUTCOMES)[number];

export const RESEARCH_NEGATIVE_CONTROL_OUTCOMES = [
  "passed",
  "failed",
  "not-run",
] as const;

export type ResearchNegativeControlOutcome =
  (typeof RESEARCH_NEGATIVE_CONTROL_OUTCOMES)[number];

export const RESEARCH_DUPLICATE_ASSESSMENTS = [
  "no-match",
  "possible-duplicate",
  "duplicate",
  "not-applicable",
  "unknown",
] as const;

export type ResearchDuplicateAssessment =
  (typeof RESEARCH_DUPLICATE_ASSESSMENTS)[number];

export interface ResearchTargetIdentifier {
  kind: string;
  value: string;
}

export interface ResearchFrozenArtifact {
  label: string;
  reference: string;
  sha256: string;
  bytes?: number;
}

export interface ResearchTarget {
  name: string;
  kind: ResearchTargetKind;
  identifiers: ResearchTargetIdentifier[];
  artifacts: ResearchFrozenArtifact[];
}

export interface ResearchRuleSource {
  url: string;
  accessedAt: string;
}

export interface ResearchScope {
  program: string;
  authorization: string;
  allowedActions: string[];
  excludedActions: string[];
  ruleSources: ResearchRuleSource[];
  localRoots: string[];
  authorizationExpiresAt?: string;
}

export interface ResearchHypothesisFingerprintInput {
  targetFamily: string;
  attackerPosition: string;
  trustBoundary: string;
  primitive: string;
  privilegedConsumer: string;
  lifecycle: string;
  impact: string;
}

export interface ResearchHypothesisFingerprint extends ResearchHypothesisFingerprintInput {
  key: string;
}

export interface ResearchHypothesisLease {
  ownerSessionId: string;
  claimedAtMs: number;
  expiresAtMs: number;
}

export interface ResearchEvidenceInput {
  kind: ResearchEvidenceKind;
  summary: string;
  reference: string;
  supports: ResearchEvidenceSupport[];
  sha256?: string;
  bytes?: number;
  locator?: string;
  tool?: string;
  command?: string;
  sensitive?: boolean;
}

export interface ResearchEvidence extends ResearchEvidenceInput {
  id: string;
  hypothesisId: string;
  producerSessionId: string;
  createdAtMs: number;
  verification: "runtime-verified" | "declared";
  verifiedAtMs?: number;
}

export interface ResearchNegativeControlInput {
  description: string;
  observedResult: string;
  outcome: ResearchNegativeControlOutcome;
}

export interface ResearchExperimentInput {
  title: string;
  environment: string;
  preconditions: string[];
  steps: string[];
  expectedResult: string;
  observedResult: string;
  outcome: ResearchExperimentOutcome;
  negativeControl: ResearchNegativeControlInput;
  cleanup: string;
  evidenceIds: string[];
}

export interface ResearchExperiment extends ResearchExperimentInput {
  id: string;
  hypothesisId: string;
  producerSessionId: string;
  createdAtMs: number;
}

export interface ResearchDuplicateCheckInput {
  searchedSources: string[];
  queries: string[];
  closestMatches: string[];
  assessment: ResearchDuplicateAssessment;
  reasoning: string;
  evidenceIds: string[];
}

export interface ResearchDuplicateCheck extends ResearchDuplicateCheckInput {
  id: string;
  hypothesisId: string;
  producerSessionId: string;
  createdAtMs: number;
}

export interface ResearchHypothesisReviewInput {
  decision: "verified" | "rejected" | "inconclusive";
  blind: boolean;
  rationale: string;
  evidenceIds: string[];
}

export interface ResearchHypothesisReview extends ResearchHypothesisReviewInput {
  id: string;
  reviewerSessionId: string;
  reviewedRevision: number;
  createdAtMs: number;
}

export interface ResearchHypothesis {
  id: string;
  revision: number;
  title: string;
  invariant: string;
  affectedScope: string;
  fingerprint: ResearchHypothesisFingerprint;
  status: ResearchHypothesisStatus;
  createdBySessionId: string;
  createdAtMs: number;
  updatedAtMs: number;
  lease?: ResearchHypothesisLease;
  evidenceIds: string[];
  analysisReceiptIds: string[];
  experimentIds: string[];
  duplicateCheckIds: string[];
  reviews: ResearchHypothesisReview[];
  /** Validated reference to the generic Agent Teams board; never a research verdict. */
  teamTaskId?: string;
  verdictRationale?: string;
}

export type ResearchCampaignStatus = "active" | "archived";

export type ResearchAuditAction =
  | "campaign-created"
  | "campaign-archived"
  | "hypothesis-created"
  | "hypothesis-claimed"
  | "hypothesis-released"
  | "evidence-added"
  | "analysis-receipt-ingested"
  | "experiment-recorded"
  | "duplicate-check-recorded"
  | "hypothesis-reviewed"
  | "hypothesis-team-task-linked"
  | "hypothesis-transitioned";

export interface ResearchAuditEvent {
  sequence: number;
  atMs: number;
  actorSessionId: string;
  action: ResearchAuditAction;
  entityId: string;
  campaignRevision: number;
  hypothesisRevision?: number;
}

export interface ResearchCampaign {
  id: string;
  revision: number;
  rootSessionId: string;
  title: string;
  status: ResearchCampaignStatus;
  target: ResearchTarget;
  scope: ResearchScope;
  /** Digest of the immutable target and authorization scope. */
  freezeDigest: string;
  createdAtMs: number;
  updatedAtMs: number;
  hypotheses: ResearchHypothesis[];
  evidence: ResearchEvidence[];
  analysisReceipts: AnalysisProducerReceipt[];
  experiments: ResearchExperiment[];
  duplicateChecks: ResearchDuplicateCheck[];
  audit: ResearchAuditEvent[];
}

export interface ResearchCampaignSummary {
  id: string;
  revision: number;
  title: string;
  status: ResearchCampaignStatus;
  rootSessionId: string;
  targetName: string;
  hypothesisCounts: Partial<Record<ResearchHypothesisStatus, number>>;
}

export type ResearchCampaignCommandRequest = { sessionId: string } & (
  | { action: "list" }
  | { action: "status" }
  | {
      action: "create-campaign";
      title: string;
      target: ResearchTarget;
      scope: ResearchScope;
    }
  | { action: "archive-campaign"; expectedRevision: number }
  | {
      action: "create-hypothesis";
      title: string;
      invariant: string;
      affectedScope: string;
      fingerprint: ResearchHypothesisFingerprintInput;
    }
  | {
      action: "claim-hypothesis";
      hypothesisId: string;
      expectedRevision: number;
      leaseSeconds?: number;
    }
  | {
      action: "release-hypothesis";
      hypothesisId: string;
      expectedRevision: number;
    }
  | {
      action: "link-team-task";
      hypothesisId: string;
      expectedRevision: number;
      teamTaskId: string;
    }
  | {
      action: "add-evidence";
      hypothesisId: string;
      expectedRevision: number;
      evidence: ResearchEvidenceInput;
    }
  | {
      action: "ingest-analysis-run";
      hypothesisId: string;
      expectedRevision: number;
      producer: AnalysisProducerKind;
      statusPath: string;
    }
  | {
      action: "record-experiment";
      hypothesisId: string;
      expectedRevision: number;
      experiment: ResearchExperimentInput;
    }
  | {
      action: "record-duplicate-check";
      hypothesisId: string;
      expectedRevision: number;
      duplicateCheck: ResearchDuplicateCheckInput;
    }
  | {
      action: "review-hypothesis";
      hypothesisId: string;
      expectedRevision: number;
      review: ResearchHypothesisReviewInput;
    }
  | {
      action: "transition-hypothesis";
      hypothesisId: string;
      expectedRevision: number;
      status: ResearchHypothesisStatus;
      rationale: string;
    }
);

export interface ResearchCampaignCommandResult {
  message: string;
  campaigns?: ResearchCampaignSummary[];
  snapshot?: ResearchCampaign;
}
import type {
  AnalysisProducerKind,
  AnalysisProducerReceipt,
} from "./analysis-producer/contracts.js";


export type {
  AnalysisProducerKind,
  AnalysisProducerReceipt,
  AnalysisProducerReceiptDraft,
} from "./analysis-producer/contracts.js";
