import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { ANALYSIS_PRODUCER_KINDS } from "./analysis-producer/contracts.js";
import {
  RESEARCH_DUPLICATE_ASSESSMENTS,
  RESEARCH_EVIDENCE_KINDS,
  RESEARCH_EVIDENCE_SUPPORTS,
  RESEARCH_EXPERIMENT_OUTCOMES,
  RESEARCH_HYPOTHESIS_STATUSES,
  RESEARCH_NEGATIVE_CONTROL_OUTCOMES,
  RESEARCH_TARGET_KINDS,
  type ResearchCampaignCommandRequest,
} from "./contracts.js";

const strict = { additionalProperties: false };
const text = (maxLength: number) =>
  Type.String({ minLength: 1, maxLength, pattern: "\\S" });
const id = text(256);
const timestampText = text(80);
const sha256 = Type.String({ pattern: "^[a-fA-F0-9]{64}$" });
const analysisProducerKindSchema = Type.Union(
  ANALYSIS_PRODUCER_KINDS.map((value) => Type.Literal(value)),
);
const analysisStatusSchema = Type.Union([
  Type.Literal("ok"),
  Type.Literal("partial"),
  Type.Literal("failed"),
  Type.Literal("skipped"),
]);
const analysisArtifactRoleSchema = Type.Union([
  Type.Literal("root-target"),
  Type.Literal("effective-input"),
  Type.Literal("output"),
  Type.Literal("job"),
  Type.Literal("status"),
  Type.Literal("provenance"),
]);

const analysisIdentitySchema = Type.Object(
  {
    id: text(500),
    version: text(500),
    buildSha256: Type.Optional(sha256),
    details: Type.Optional(
      Type.Record(
        Type.String({ pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$" }),
        Type.Union([Type.String({ maxLength: 2048 }), Type.Number(), Type.Boolean()]),
        { maxProperties: 64 },
      ),
    ),
  },
  strict,
);

const analysisArtifactSchema = Type.Object(
  {
    id,
    role: analysisArtifactRoleSchema,
    reference: text(8000),
    sha256,
    bytes: Type.Optional(Type.Integer({ minimum: 0 })),
    mediaType: Type.Optional(text(500)),
    verification: Type.Union([
      Type.Literal("runtime-verified"),
      Type.Literal("declared"),
    ]),
  },
  strict,
);

const analysisDerivationSchema = Type.Object(
  {
    outputArtifactId: id,
    inputArtifactIds: Type.Array(id, { maxItems: 1024, uniqueItems: true }),
    command: text(16000),
    status: analysisStatusSchema,
    stepIndex: Type.Optional(Type.Integer({ minimum: 0 })),
    stepId: Type.Optional(text(500)),
    configurationSha256: Type.Optional(sha256),
  },
  strict,
);

const analysisCoverageSchema = Type.Object(
  {
    complete: Type.Boolean(),
    partialReasons: Type.Array(text(8000), { maxItems: 1024, uniqueItems: true }),
    totalSteps: Type.Integer({ minimum: 0 }),
    okSteps: Type.Integer({ minimum: 0 }),
    partialSteps: Type.Integer({ minimum: 0 }),
    failedSteps: Type.Integer({ minimum: 0 }),
    skippedSteps: Type.Integer({ minimum: 0 }),
    materializedFunctions: Type.Optional(Type.Integer({ minimum: 0 })),
    discoveredFunctions: Type.Optional(Type.Integer({ minimum: 0 })),
    unsupportedCount: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  strict,
);

const analysisReceiptSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    producer: Type.Object(
      {
        kind: analysisProducerKindSchema,
        contract: Type.Literal("analysis-jobs-v1"),
        experimental: Type.Boolean(),
        identities: Type.Array(analysisIdentitySchema, { maxItems: 256 }),
      },
      strict,
    ),
    status: analysisStatusSchema,
    rootTarget: analysisArtifactSchema,
    artifacts: Type.Array(analysisArtifactSchema, { minItems: 4, maxItems: 4096 }),
    derivations: Type.Array(analysisDerivationSchema, { maxItems: 4096 }),
    coverage: analysisCoverageSchema,
    source: Type.Object(
      {
        statusArtifactId: id,
        provenanceArtifactId: id,
        jobArtifactId: Type.Optional(id),
        executionId: Type.Optional(text(500)),
        sessionId: Type.Optional(text(500)),
        generation: Type.Optional(Type.Integer({ minimum: 0 })),
      },
      strict,
    ),
    warnings: Type.Array(text(8000), { maxItems: 256, uniqueItems: true }),
    receiptSha256: sha256,
    id,
    hypothesisId: id,
    ingestedBySessionId: id,
    ingestedAtMs: Type.Integer({ minimum: 0 }),
  },
  strict,
);

const targetKindSchema = Type.Union(
  RESEARCH_TARGET_KINDS.map((value) => Type.Literal(value)),
);
const evidenceKindSchema = Type.Union(
  RESEARCH_EVIDENCE_KINDS.map((value) => Type.Literal(value)),
);
const evidenceSupportSchema = Type.Union(
  RESEARCH_EVIDENCE_SUPPORTS.map((value) => Type.Literal(value)),
);
const hypothesisStatusSchema = Type.Union(
  RESEARCH_HYPOTHESIS_STATUSES.map((value) => Type.Literal(value)),
);
const experimentOutcomeSchema = Type.Union(
  RESEARCH_EXPERIMENT_OUTCOMES.map((value) => Type.Literal(value)),
);
const negativeControlOutcomeSchema = Type.Union(
  RESEARCH_NEGATIVE_CONTROL_OUTCOMES.map((value) => Type.Literal(value)),
);
const duplicateAssessmentSchema = Type.Union(
  RESEARCH_DUPLICATE_ASSESSMENTS.map((value) => Type.Literal(value)),
);

export const researchTargetIdentifierSchema = Type.Object(
  { kind: text(120), value: text(1000) },
  strict,
);

export const researchFrozenArtifactSchema = Type.Object(
  {
    label: text(240),
    reference: text(4000),
    sha256,
    bytes: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  strict,
);

export const researchTargetSchema = Type.Object(
  {
    name: text(300),
    kind: targetKindSchema,
    identifiers: Type.Array(researchTargetIdentifierSchema, {
      minItems: 1,
      maxItems: 64,
    }),
    artifacts: Type.Array(researchFrozenArtifactSchema, { maxItems: 512 }),
  },
  strict,
);

export const researchRuleSourceSchema = Type.Object(
  { url: text(4000), accessedAt: timestampText },
  strict,
);

export const researchScopeSchema = Type.Object(
  {
    program: text(300),
    authorization: text(8000),
    allowedActions: Type.Array(text(1000), { minItems: 1, maxItems: 128 }),
    excludedActions: Type.Array(text(1000), { maxItems: 128 }),
    ruleSources: Type.Array(researchRuleSourceSchema, { maxItems: 128 }),
    localRoots: Type.Array(text(4000), { maxItems: 128 }),
    authorizationExpiresAt: Type.Optional(timestampText),
  },
  strict,
);

export const researchFingerprintInputSchema = Type.Object(
  {
    targetFamily: text(500),
    attackerPosition: text(2000),
    trustBoundary: text(2000),
    primitive: text(2000),
    privilegedConsumer: text(2000),
    lifecycle: text(2000),
    impact: text(2000),
  },
  strict,
);

const researchFingerprintSchema = Type.Object(
  { ...researchFingerprintInputSchema.properties, key: sha256 },
  strict,
);

const researchLeaseSchema = Type.Object(
  {
    ownerSessionId: id,
    claimedAtMs: Type.Integer({ minimum: 0 }),
    expiresAtMs: Type.Integer({ minimum: 0 }),
  },
  strict,
);

export const researchEvidenceInputSchema = Type.Object(
  {
    kind: evidenceKindSchema,
    summary: text(8000),
    reference: text(8000),
    supports: Type.Array(evidenceSupportSchema, {
      minItems: 1,
      maxItems: RESEARCH_EVIDENCE_SUPPORTS.length,
      uniqueItems: true,
    }),
    sha256: Type.Optional(sha256),
    bytes: Type.Optional(Type.Integer({ minimum: 0 })),
    locator: Type.Optional(text(4000)),
    tool: Type.Optional(text(500)),
    command: Type.Optional(text(8000)),
    sensitive: Type.Optional(Type.Boolean()),
  },
  strict,
);

const researchEvidenceSchema = Type.Object(
  {
    ...researchEvidenceInputSchema.properties,
    id,
    hypothesisId: id,
    producerSessionId: id,
    createdAtMs: Type.Integer({ minimum: 0 }),
    verification: Type.Union([
      Type.Literal("runtime-verified"),
      Type.Literal("declared"),
    ]),
    verifiedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  strict,
);

const negativeControlInputSchema = Type.Object(
  {
    description: text(8000),
    observedResult: text(8000),
    outcome: negativeControlOutcomeSchema,
  },
  strict,
);

export const researchExperimentInputSchema = Type.Object(
  {
    title: text(500),
    environment: text(8000),
    preconditions: Type.Array(text(4000), { maxItems: 128 }),
    steps: Type.Array(text(8000), { minItems: 1, maxItems: 256 }),
    expectedResult: text(8000),
    observedResult: text(16000),
    outcome: experimentOutcomeSchema,
    negativeControl: negativeControlInputSchema,
    cleanup: text(8000),
    evidenceIds: Type.Array(id, {
      minItems: 1,
      maxItems: 256,
      uniqueItems: true,
    }),
  },
  strict,
);

const researchExperimentSchema = Type.Object(
  {
    ...researchExperimentInputSchema.properties,
    id,
    hypothesisId: id,
    producerSessionId: id,
    createdAtMs: Type.Integer({ minimum: 0 }),
  },
  strict,
);

export const researchDuplicateCheckInputSchema = Type.Object(
  {
    searchedSources: Type.Array(text(4000), {
      minItems: 1,
      maxItems: 256,
      uniqueItems: true,
    }),
    queries: Type.Array(text(4000), { minItems: 1, maxItems: 256 }),
    closestMatches: Type.Array(text(8000), { maxItems: 128 }),
    assessment: duplicateAssessmentSchema,
    reasoning: text(16000),
    evidenceIds: Type.Array(id, { maxItems: 256, uniqueItems: true }),
  },
  strict,
);

const researchDuplicateCheckSchema = Type.Object(
  {
    ...researchDuplicateCheckInputSchema.properties,
    id,
    hypothesisId: id,
    producerSessionId: id,
    createdAtMs: Type.Integer({ minimum: 0 }),
  },
  strict,
);

export const researchReviewInputSchema = Type.Object(
  {
    decision: Type.Union([
      Type.Literal("verified"),
      Type.Literal("rejected"),
      Type.Literal("inconclusive"),
    ]),
    blind: Type.Boolean(),
    rationale: text(16000),
    evidenceIds: Type.Array(id, {
      minItems: 1,
      maxItems: 256,
      uniqueItems: true,
    }),
  },
  strict,
);

const researchReviewSchema = Type.Object(
  {
    ...researchReviewInputSchema.properties,
    id,
    reviewerSessionId: id,
    reviewedRevision: Type.Integer({ minimum: 1 }),
    createdAtMs: Type.Integer({ minimum: 0 }),
  },
  strict,
);

const researchHypothesisSchema = Type.Object(
  {
    id,
    revision: Type.Integer({ minimum: 1 }),
    title: text(500),
    invariant: text(16000),
    affectedScope: text(8000),
    fingerprint: researchFingerprintSchema,
    status: hypothesisStatusSchema,
    createdBySessionId: id,
    createdAtMs: Type.Integer({ minimum: 0 }),
    updatedAtMs: Type.Integer({ minimum: 0 }),
    lease: Type.Optional(researchLeaseSchema),
    evidenceIds: Type.Array(id, { maxItems: 4096, uniqueItems: true }),
    analysisReceiptIds: Type.Array(id, { maxItems: 1024, uniqueItems: true }),
    experimentIds: Type.Array(id, { maxItems: 1024, uniqueItems: true }),
    duplicateCheckIds: Type.Array(id, { maxItems: 1024, uniqueItems: true }),
    reviews: Type.Array(researchReviewSchema, { maxItems: 256 }),
    teamTaskId: Type.Optional(id),
    verdictRationale: Type.Optional(text(16000)),
  },
  strict,
);

const auditActionSchema = Type.Union([
  Type.Literal("campaign-created"),
  Type.Literal("campaign-archived"),
  Type.Literal("hypothesis-created"),
  Type.Literal("hypothesis-claimed"),
  Type.Literal("hypothesis-released"),
  Type.Literal("evidence-added"),
  Type.Literal("analysis-receipt-ingested"),
  Type.Literal("experiment-recorded"),
  Type.Literal("duplicate-check-recorded"),
  Type.Literal("hypothesis-reviewed"),
  Type.Literal("hypothesis-team-task-linked"),
  Type.Literal("hypothesis-transitioned"),
]);

const researchAuditEventSchema = Type.Object(
  {
    sequence: Type.Integer({ minimum: 1 }),
    atMs: Type.Integer({ minimum: 0 }),
    actorSessionId: id,
    action: auditActionSchema,
    entityId: id,
    campaignRevision: Type.Integer({ minimum: 1 }),
    hypothesisRevision: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  strict,
);

export const researchCampaignSchema = Type.Object(
  {
    id,
    revision: Type.Integer({ minimum: 1, maximum: 8192 }),
    rootSessionId: id,
    title: text(500),
    status: Type.Union([Type.Literal("active"), Type.Literal("archived")]),
    target: researchTargetSchema,
    scope: researchScopeSchema,
    freezeDigest: sha256,
    createdAtMs: Type.Integer({ minimum: 0 }),
    updatedAtMs: Type.Integer({ minimum: 0 }),
    hypotheses: Type.Array(researchHypothesisSchema, { maxItems: 1024 }),
    evidence: Type.Array(researchEvidenceSchema, { maxItems: 4096 }),
    analysisReceipts: Type.Array(analysisReceiptSchema, { maxItems: 1024 }),
    experiments: Type.Array(researchExperimentSchema, { maxItems: 1024 }),
    duplicateChecks: Type.Array(researchDuplicateCheckSchema, {
      maxItems: 1024,
    }),
    audit: Type.Array(researchAuditEventSchema, {
      minItems: 1,
      maxItems: 8192,
    }),
  },
  strict,
);

export const researchCampaignStateSchema = Type.Object(
  {
    version: Type.Literal(2),
    campaigns: Type.Array(researchCampaignSchema, { maxItems: 128 }),
  },
  strict,
);

const commandBase = { sessionId: id };
const expectedHypothesis = {
  ...commandBase,
  hypothesisId: id,
  expectedRevision: Type.Integer({ minimum: 1 }),
};

export const researchCampaignCommandSchema = Type.Union([
  ...["list", "status"].map((action) =>
    Type.Object({ ...commandBase, action: Type.Literal(action) }, strict),
  ),
  Type.Object(
    {
      ...commandBase,
      action: Type.Literal("create-campaign"),
      title: text(500),
      target: researchTargetSchema,
      scope: researchScopeSchema,
    },
    strict,
  ),
  Type.Object(
    {
      ...commandBase,
      action: Type.Literal("archive-campaign"),
      expectedRevision: Type.Integer({ minimum: 1 }),
    },
    strict,
  ),
  Type.Object(
    {
      ...commandBase,
      action: Type.Literal("create-hypothesis"),
      title: text(500),
      invariant: text(16000),
      affectedScope: text(8000),
      fingerprint: researchFingerprintInputSchema,
    },
    strict,
  ),
  Type.Object(
    {
      ...expectedHypothesis,
      action: Type.Literal("claim-hypothesis"),
      leaseSeconds: Type.Optional(
        Type.Integer({ minimum: 60, maximum: 14400 }),
      ),
    },
    strict,
  ),
  Type.Object(
    { ...expectedHypothesis, action: Type.Literal("release-hypothesis") },
    strict,
  ),
  Type.Object(
    {
      ...expectedHypothesis,
      action: Type.Literal("link-team-task"),
      teamTaskId: id,
    },
    strict,
  ),
  Type.Object(
    {
      ...expectedHypothesis,
      action: Type.Literal("add-evidence"),
      evidence: researchEvidenceInputSchema,
    },
    strict,
  ),
  Type.Object(
    {
      ...expectedHypothesis,
      action: Type.Literal("ingest-analysis-run"),
      producer: analysisProducerKindSchema,
      statusPath: text(8000),
    },
    strict,
  ),
  Type.Object(
    {
      ...expectedHypothesis,
      action: Type.Literal("record-experiment"),
      experiment: researchExperimentInputSchema,
    },
    strict,
  ),
  Type.Object(
    {
      ...expectedHypothesis,
      action: Type.Literal("record-duplicate-check"),
      duplicateCheck: researchDuplicateCheckInputSchema,
    },
    strict,
  ),
  Type.Object(
    {
      ...expectedHypothesis,
      action: Type.Literal("review-hypothesis"),
      review: researchReviewInputSchema,
    },
    strict,
  ),
  Type.Object(
    {
      ...expectedHypothesis,
      action: Type.Literal("transition-hypothesis"),
      status: hypothesisStatusSchema,
      rationale: text(16000),
    },
    strict,
  ),
]);

export function isResearchCampaignCommand(
  value: unknown,
): value is ResearchCampaignCommandRequest {
  return Value.Check(researchCampaignCommandSchema, value);
}
