import { randomUUID } from "node:crypto";

import type {
  AnalysisProducerReceipt,
  AnalysisProducerReceiptDraft,
  AnalysisReceiptArtifact,
  IngestAnalysisRunInput,
} from "./analysis-producer/contracts.js";
import type {
  ResearchAuditAction,
  ResearchCampaign,
  ResearchCampaignCommandRequest,
  ResearchCampaignCommandResult,
  ResearchCampaignSummary,
  ResearchDuplicateCheck,
  ResearchEvidence,
  ResearchEvidenceInput,
  ResearchEvidenceSupport,
  ResearchExperiment,
  ResearchHypothesis,
  ResearchHypothesisStatus,
  ResearchScope,
  ResearchTarget,
} from "./contracts.js";
import {
  createResearchFingerprint,
  createResearchFreezeDigest,
} from "./fingerprint.js";
import { isResearchCampaignCommand } from "./schema.js";
import { ResearchCampaignStore, type ResearchCampaignState } from "./store.js";

export interface ResearchCampaignSession {
  sessionId: string;
  parentSessionId?: string | null;
  sessionKind: string;
  status: string;
  archived: boolean;
}

export interface ResearchCampaignPorts {
  getSession(sessionId: string): Promise<ResearchCampaignSession | undefined>;
  getTeamTask?(
    sessionId: string,
    taskId: string,
  ): Promise<
    | {
        rootSessionId: string;
        task: { id: string; status: string; sessionId?: string };
      }
    | undefined
  >;
  verifyArtifact?(
    localRoots: readonly string[],
    reference: string,
  ): Promise<{ reference: string; sha256: string; bytes: number }>;
  ingestAnalysisRun?(
    input: IngestAnalysisRunInput,
  ): Promise<AnalysisProducerReceiptDraft>;
}

export interface ResearchCampaignServiceOptions {
  nowMs?: () => number;
}

const DEFAULT_LEASE_SECONDS = 30 * 60;
const TERMINAL_STATUSES = new Set<ResearchHypothesisStatus>([
  "reportable",
  "duplicate-or-known",
  "rejected",
]);

const STATUS_TRANSITIONS: Readonly<
  Record<ResearchHypothesisStatus, ReadonlySet<ResearchHypothesisStatus>>
> = {
  lead: new Set(["candidate", "unknown", "duplicate-or-known", "rejected"]),
  candidate: new Set([
    "lead",
    "validated-condition",
    "unknown",
    "duplicate-or-known",
    "rejected",
  ]),
  "validated-condition": new Set([
    "candidate",
    "demonstrated-impact",
    "unknown",
    "duplicate-or-known",
    "rejected",
  ]),
  "demonstrated-impact": new Set([
    "validated-condition",
    "reportable",
    "unknown",
    "duplicate-or-known",
    "rejected",
  ]),
  unknown: new Set(["lead", "candidate", "duplicate-or-known", "rejected"]),
  reportable: new Set(),
  "duplicate-or-known": new Set(),
  rejected: new Set(),
};

const VALIDATED_SUPPORTS: readonly ResearchEvidenceSupport[] = [
  "exact-target",
  "attacker-position",
  "controlled-input",
  "transformations",
  "privileged-consumer",
  "constraints-protections",
];

const IMPACT_SUPPORTS: readonly ResearchEvidenceSupport[] = [
  ...VALIDATED_SUPPORTS,
  "realized-effect",
  "negative-control",
  "reproduction",
];

const REPORTABLE_SUPPORTS: readonly ResearchEvidenceSupport[] = [
  ...IMPACT_SUPPORTS,
  "duplicate-status",
  "affected-scope",
];

export class ResearchCampaignService {
  readonly store: ResearchCampaignStore;
  private readonly nowMs: () => number;

  constructor(
    dataDir: string,
    private readonly ports: ResearchCampaignPorts,
    options: ResearchCampaignServiceOptions = {},
  ) {
    this.store = new ResearchCampaignStore(dataDir);
    this.nowMs = options.nowMs ?? Date.now;
  }

  async execute(
    request: ResearchCampaignCommandRequest,
  ): Promise<ResearchCampaignCommandResult> {
    if (!isResearchCampaignCommand(request)) {
      throw new Error("Invalid security campaign command");
    }

    return this.store.serial(async () => {
      const state = await this.store.read();
      const caller = await this.requireSession(request.sessionId);
      const lineage = await this.sessionLineage(caller);

      if (request.action === "list") {
        return {
          message: "Security campaigns visible to this session lineage.",
          campaigns: this.visibleCampaigns(state, lineage).map(
            summarizeCampaign,
          ),
        };
      }

      if (request.action === "create-campaign") {
        return this.createCampaign(state, caller, request);
      }

      const campaign = this.activeCampaign(state, lineage);
      if (request.action === "status") {
        return campaign
          ? {
              message:
                "Active security campaign. Runtime status is not a research verdict.",
              campaigns: this.visibleCampaigns(state, lineage).map(
                summarizeCampaign,
              ),
              snapshot: this.snapshot(campaign),
            }
          : {
              message: "No active security campaign for this session lineage.",
              campaigns: this.visibleCampaigns(state, lineage).map(
                summarizeCampaign,
              ),
            };
      }
      if (!campaign)
        throw new Error("No active security campaign for this session");

      switch (request.action) {
        case "archive-campaign":
          return this.archiveCampaign(
            state,
            campaign,
            caller,
            request.expectedRevision,
          );
        case "create-hypothesis":
          return this.createHypothesis(state, campaign, caller, request);
        case "claim-hypothesis":
          return this.claimHypothesis(state, campaign, caller, request);
        case "release-hypothesis":
          return this.releaseHypothesis(state, campaign, caller, request);
        case "link-team-task":
          return this.linkTeamTask(state, campaign, caller, request);
        case "add-evidence":
          return this.addEvidence(state, campaign, caller, request);
        case "ingest-analysis-run":
          return this.ingestAnalysisRun(state, campaign, caller, request);
        case "record-experiment":
          return this.recordExperiment(state, campaign, caller, request);
        case "record-duplicate-check":
          return this.recordDuplicateCheck(state, campaign, caller, request);
        case "review-hypothesis":
          return this.reviewHypothesis(state, campaign, caller, request);
        case "transition-hypothesis":
          return this.transitionHypothesis(state, campaign, caller, request);
      }
    });
  }

  async reminder(sessionId: string): Promise<string> {
    const session = await this.requireSession(sessionId);
    const lineage = await this.sessionLineage(session);
    const campaign = this.activeCampaign(await this.store.read(), lineage);
    if (!campaign) return "";

    const owned = campaign.hypotheses.filter(
      (hypothesis) =>
        this.activeLease(hypothesis)?.ownerSessionId === sessionId,
    );
    const identifiers = campaign.target.identifiers
      .map((entry) => `${entry.kind}=${entry.value}`)
      .join("; ");
    return [
      `[Security campaign: ${campaign.title}; id ${campaign.id}; revision ${campaign.revision}]`,
      `Frozen target: ${campaign.target.name}; ${identifiers}; freeze sha256 ${campaign.freezeDigest}.`,
      `Authorized program: ${campaign.scope.program}. Allowed: ${campaign.scope.allowedActions.join("; ")}. Excluded: ${campaign.scope.excludedActions.join("; ") || "none recorded"}.`,
      "Use research_coordination for campaign state. Never promote a lead from prose alone; immutable evidence, a positive experiment with negative control, duplicate review, and fresh independent verification gate reportable status.",
      owned.length > 0
        ? `This session owns: ${owned.map((hypothesis) => `${hypothesis.id} (${hypothesis.status}${hypothesis.teamTaskId ? `; team task ${hypothesis.teamTaskId}` : ""})`).join(", ")}.`
        : "This session owns no hypothesis lease.",
    ].join("\n");
  }

  private async createCampaign(
    state: ResearchCampaignState,
    caller: ResearchCampaignSession,
    request: Extract<
      ResearchCampaignCommandRequest,
      { action: "create-campaign" }
    >,
  ): Promise<ResearchCampaignCommandResult> {
    this.requireRootSession(caller);
    if (
      state.campaigns.some(
        (campaign) =>
          campaign.rootSessionId === caller.sessionId &&
          campaign.status === "active",
      )
    ) {
      throw new Error(
        "This root session already has an active security campaign",
      );
    }

    const now = this.nowMs();
    const target = await this.normalizeAndVerifyTarget(
      request.target,
      request.scope,
    );
    const scope = structuredClone(request.scope);
    const campaign: ResearchCampaign = {
      id: randomUUID(),
      revision: 1,
      rootSessionId: caller.sessionId,
      title: request.title,
      status: "active",
      target,
      scope,
      freezeDigest: createResearchFreezeDigest(target, scope),
      createdAtMs: now,
      updatedAtMs: now,
      hypotheses: [],
      evidence: [],
      analysisReceipts: [],
      experiments: [],
      duplicateChecks: [],
      audit: [
        {
          sequence: 1,
          atMs: now,
          actorSessionId: caller.sessionId,
          action: "campaign-created",
          entityId: "",
          campaignRevision: 1,
        },
      ],
    };
    campaign.audit[0]!.entityId = campaign.id;
    state.campaigns.push(campaign);
    await this.store.save(state);
    return {
      message: `Created and froze security campaign ${campaign.title}.`,
      snapshot: this.snapshot(campaign),
    };
  }

  private async archiveCampaign(
    state: ResearchCampaignState,
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    expectedRevision: number,
  ): Promise<ResearchCampaignCommandResult> {
    this.requireLeader(campaign, caller);
    this.requireCampaignRevision(campaign, expectedRevision);
    const leased = campaign.hypotheses.find((hypothesis) =>
      this.activeLease(hypothesis),
    );
    if (leased) {
      throw new Error(
        `Release active hypothesis lease ${leased.id} before archiving`,
      );
    }
    campaign.status = "archived";
    this.recordAudit(campaign, caller, "campaign-archived", campaign.id);
    await this.store.save(state);
    return {
      message:
        "Security campaign archived. Evidence and negative results were preserved.",
      campaigns: [summarizeCampaign(campaign)],
      snapshot: this.snapshot(campaign),
    };
  }

  private async createHypothesis(
    state: ResearchCampaignState,
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    request: Extract<
      ResearchCampaignCommandRequest,
      { action: "create-hypothesis" }
    >,
  ): Promise<ResearchCampaignCommandResult> {
    const fingerprint = createResearchFingerprint(request.fingerprint);
    const existing = campaign.hypotheses.find(
      (hypothesis) => hypothesis.fingerprint.key === fingerprint.key,
    );
    if (existing) {
      throw new Error(
        `A hypothesis with this root-cause fingerprint already exists: ${existing.id}`,
      );
    }
    const now = this.nowMs();
    const hypothesis: ResearchHypothesis = {
      id: randomUUID(),
      revision: 1,
      title: request.title,
      invariant: request.invariant,
      affectedScope: request.affectedScope,
      fingerprint,
      status: "lead",
      createdBySessionId: caller.sessionId,
      createdAtMs: now,
      updatedAtMs: now,
      evidenceIds: [],
      analysisReceiptIds: [],
      experimentIds: [],
      duplicateCheckIds: [],
      reviews: [],
    };
    campaign.hypotheses.push(hypothesis);
    this.recordAudit(
      campaign,
      caller,
      "hypothesis-created",
      hypothesis.id,
      hypothesis,
      now,
    );
    await this.store.save(state);
    return {
      message: `Created lead ${hypothesis.id}; claim it before adding research records.`,
      snapshot: this.snapshot(campaign),
    };
  }

  private async claimHypothesis(
    state: ResearchCampaignState,
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    request: Extract<
      ResearchCampaignCommandRequest,
      { action: "claim-hypothesis" }
    >,
  ): Promise<ResearchCampaignCommandResult> {
    const hypothesis = this.requireHypothesis(campaign, request.hypothesisId);
    this.requireHypothesisRevision(hypothesis, request.expectedRevision);
    this.requireMutableHypothesis(hypothesis);
    const activeLease = this.activeLease(hypothesis);
    if (activeLease && activeLease.ownerSessionId !== caller.sessionId) {
      throw new Error(
        `Hypothesis is leased to session ${activeLease.ownerSessionId} until ${activeLease.expiresAtMs}`,
      );
    }
    const now = this.nowMs();
    const leaseSeconds = request.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    hypothesis.lease = {
      ownerSessionId: caller.sessionId,
      claimedAtMs: now,
      expiresAtMs: now + leaseSeconds * 1000,
    };
    this.touchHypothesis(hypothesis, now);
    this.recordAudit(
      campaign,
      caller,
      "hypothesis-claimed",
      hypothesis.id,
      hypothesis,
      now,
    );
    await this.store.save(state);
    return {
      message: `Hypothesis leased to this session for ${leaseSeconds} seconds.`,
      snapshot: this.snapshot(campaign),
    };
  }

  private async releaseHypothesis(
    state: ResearchCampaignState,
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    request: Extract<
      ResearchCampaignCommandRequest,
      { action: "release-hypothesis" }
    >,
  ): Promise<ResearchCampaignCommandResult> {
    const hypothesis = this.requireHypothesis(campaign, request.hypothesisId);
    this.requireHypothesisRevision(hypothesis, request.expectedRevision);
    if (!hypothesis.lease)
      throw new Error("Hypothesis has no lease to release");
    if (
      hypothesis.lease.ownerSessionId !== caller.sessionId &&
      caller.sessionId !== campaign.rootSessionId
    ) {
      throw new Error(
        "Only the lease owner or campaign leader may release this hypothesis",
      );
    }
    const now = this.nowMs();
    delete hypothesis.lease;
    this.touchHypothesis(hypothesis, now);
    this.recordAudit(
      campaign,
      caller,
      "hypothesis-released",
      hypothesis.id,
      hypothesis,
      now,
    );
    await this.store.save(state);
    return {
      message: "Hypothesis lease released.",
      snapshot: this.snapshot(campaign),
    };
  }

  private async linkTeamTask(
    state: ResearchCampaignState,
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    request: Extract<
      ResearchCampaignCommandRequest,
      { action: "link-team-task" }
    >,
  ): Promise<ResearchCampaignCommandResult> {
    const hypothesis = this.requireHypothesis(campaign, request.hypothesisId);
    this.requireHypothesisRevision(hypothesis, request.expectedRevision);
    this.requireMutableHypothesis(hypothesis);
    if (hypothesis.teamTaskId) {
      throw new Error(
        `Hypothesis is already linked to immutable team task ${hypothesis.teamTaskId}`,
      );
    }
    if (!this.ports.getTeamTask) {
      throw new Error("Agent Teams linkage is unavailable in this runtime");
    }
    const assignment = await this.ports.getTeamTask(
      caller.sessionId,
      request.teamTaskId,
    );
    if (!assignment || assignment.rootSessionId !== campaign.rootSessionId) {
      throw new Error(
        "Team task does not belong to this campaign's root session",
      );
    }
    const leader = caller.sessionId === campaign.rootSessionId;
    if (!leader && assignment.task.sessionId !== caller.sessionId) {
      throw new Error(
        "Only the campaign leader or assigned worker may link this team task",
      );
    }
    const existing = campaign.hypotheses.find(
      (entry) =>
        entry.id !== hypothesis.id && entry.teamTaskId === request.teamTaskId,
    );
    if (existing) {
      throw new Error(
        `Team task is already linked to hypothesis ${existing.id}`,
      );
    }
    const now = this.nowMs();
    hypothesis.teamTaskId = request.teamTaskId;
    this.touchHypothesis(hypothesis, now);
    this.recordAudit(
      campaign,
      caller,
      "hypothesis-team-task-linked",
      hypothesis.id,
      hypothesis,
      now,
    );
    await this.store.save(state);
    return {
      message: `Linked Agent Teams task ${request.teamTaskId}; task status remains separate from the research verdict.`,
      snapshot: this.snapshot(campaign),
    };
  }

  private async addEvidence(
    state: ResearchCampaignState,
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    request: Extract<
      ResearchCampaignCommandRequest,
      { action: "add-evidence" }
    >,
  ): Promise<ResearchCampaignCommandResult> {
    const hypothesis = this.requireOwnedHypothesis(campaign, caller, request);
    validateEvidenceInput(request.evidence);
    const now = this.nowMs();
    const verified = await this.verifyEvidence(campaign, request.evidence);
    const evidence: ResearchEvidence = {
      ...structuredClone(request.evidence),
      ...verified.fields,
      id: randomUUID(),
      hypothesisId: hypothesis.id,
      producerSessionId: caller.sessionId,
      createdAtMs: now,
      verification: verified.verification,
      ...(verified.verification === "runtime-verified"
        ? { verifiedAtMs: now }
        : {}),
    };
    campaign.evidence.push(evidence);
    hypothesis.evidenceIds.push(evidence.id);
    this.touchHypothesis(hypothesis, now);
    this.recordAudit(
      campaign,
      caller,
      "evidence-added",
      evidence.id,
      hypothesis,
      now,
    );
    await this.store.save(state);
    return {
      message: `Recorded immutable evidence ${evidence.id}.`,
      snapshot: this.snapshot(campaign),
    };
  }

  private async ingestAnalysisRun(
    state: ResearchCampaignState,
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    request: Extract<
      ResearchCampaignCommandRequest,
      { action: "ingest-analysis-run" }
    >,
  ): Promise<ResearchCampaignCommandResult> {
    const hypothesis = this.requireOwnedHypothesis(campaign, caller, request);
    if (!this.ports.ingestAnalysisRun) {
      throw new Error("Analysis producer ingestion is unavailable in this runtime");
    }
    const draft = await this.ports.ingestAnalysisRun({
      producer: request.producer,
      statusPath: request.statusPath,
      localRoots: campaign.scope.localRoots,
    });
    if (draft.producer.kind !== request.producer) {
      throw new Error("Analysis producer adapter returned the wrong producer kind");
    }
    if (
      !campaign.target.artifacts.some(
        (artifact) =>
          artifact.sha256.toLowerCase() === draft.rootTarget.sha256.toLowerCase(),
      )
    ) {
      throw new Error(
        "Analysis root target does not match any frozen campaign artifact",
      );
    }
    if (
      campaign.analysisReceipts.some(
        (receipt) => receipt.receiptSha256 === draft.receiptSha256,
      )
    ) {
      throw new Error("This analysis receipt is already recorded");
    }
    if (
      campaign.analysisReceipts.length >= 1024 ||
      hypothesis.analysisReceiptIds.length >= 1024
    ) {
      throw new Error("Analysis receipt capacity is exhausted for this campaign");
    }
    if (
      campaign.evidence.length + draft.artifacts.length > 4096 ||
      hypothesis.evidenceIds.length + draft.artifacts.length > 4096
    ) {
      throw new Error("Evidence capacity is exhausted for this analysis receipt");
    }

    const now = this.nowMs();
    const receipt: AnalysisProducerReceipt = {
      ...structuredClone(draft),
      id: `analysis:${draft.producer.kind}:sha256:${draft.receiptSha256}`,
      hypothesisId: hypothesis.id,
      ingestedBySessionId: caller.sessionId,
      ingestedAtMs: now,
    };
    const evidence = receipt.artifacts.map((artifact) =>
      this.analysisArtifactEvidence(receipt, artifact, hypothesis.id, caller, now),
    );
    campaign.analysisReceipts.push(receipt);
    campaign.evidence.push(...evidence);
    hypothesis.analysisReceiptIds.push(receipt.id);
    hypothesis.evidenceIds.push(...evidence.map((entry) => entry.id));
    this.touchHypothesis(hypothesis, now);
    this.recordAudit(
      campaign,
      caller,
      "analysis-receipt-ingested",
      receipt.id,
      hypothesis,
      now,
    );
    await this.store.save(state);
    return {
      message: `Ingested ${receipt.producer.kind} receipt ${receipt.id} with status ${receipt.status}; the hypothesis verdict was not changed.`,
      snapshot: this.snapshot(campaign),
    };
  }

  private analysisArtifactEvidence(
    receipt: AnalysisProducerReceipt,
    artifact: AnalysisReceiptArtifact,
    hypothesisId: string,
    caller: ResearchCampaignSession,
    now: number,
  ): ResearchEvidence {
    const kind = analysisEvidenceKind(receipt, artifact);
    const producingStep = receipt.derivations.find(
      (derivation) => derivation.outputArtifactId === artifact.id,
    );
    return {
      id: randomUUID(),
      hypothesisId,
      producerSessionId: caller.sessionId,
      createdAtMs: now,
      kind,
      summary: analysisEvidenceSummary(receipt, artifact),
      reference: artifact.reference,
      supports: [analysisEvidenceSupport(receipt, artifact)],
      sha256: artifact.sha256,
      ...(artifact.bytes === undefined ? {} : { bytes: artifact.bytes }),
      tool: receipt.producer.kind,
      ...(producingStep ? { command: producingStep.command } : {}),
      verification: artifact.verification,
      ...(artifact.verification === "runtime-verified"
        ? { verifiedAtMs: now }
        : {}),
    };
  }

  private async recordExperiment(
    state: ResearchCampaignState,
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    request: Extract<
      ResearchCampaignCommandRequest,
      { action: "record-experiment" }
    >,
  ): Promise<ResearchCampaignCommandResult> {
    const hypothesis = this.requireOwnedHypothesis(campaign, caller, request);
    this.requireEvidenceIds(
      campaign,
      hypothesis,
      request.experiment.evidenceIds,
    );
    const now = this.nowMs();
    const experiment: ResearchExperiment = {
      ...structuredClone(request.experiment),
      id: randomUUID(),
      hypothesisId: hypothesis.id,
      producerSessionId: caller.sessionId,
      createdAtMs: now,
    };
    campaign.experiments.push(experiment);
    hypothesis.experimentIds.push(experiment.id);
    this.touchHypothesis(hypothesis, now);
    this.recordAudit(
      campaign,
      caller,
      "experiment-recorded",
      experiment.id,
      hypothesis,
      now,
    );
    await this.store.save(state);
    return {
      message: `Recorded experiment ${experiment.id} with outcome ${experiment.outcome}.`,
      snapshot: this.snapshot(campaign),
    };
  }

  private async recordDuplicateCheck(
    state: ResearchCampaignState,
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    request: Extract<
      ResearchCampaignCommandRequest,
      { action: "record-duplicate-check" }
    >,
  ): Promise<ResearchCampaignCommandResult> {
    const hypothesis = this.requireOwnedHypothesis(campaign, caller, request);
    this.requireEvidenceIds(
      campaign,
      hypothesis,
      request.duplicateCheck.evidenceIds,
    );
    const now = this.nowMs();
    const duplicateCheck: ResearchDuplicateCheck = {
      ...structuredClone(request.duplicateCheck),
      id: randomUUID(),
      hypothesisId: hypothesis.id,
      producerSessionId: caller.sessionId,
      createdAtMs: now,
    };
    campaign.duplicateChecks.push(duplicateCheck);
    hypothesis.duplicateCheckIds.push(duplicateCheck.id);
    this.touchHypothesis(hypothesis, now);
    this.recordAudit(
      campaign,
      caller,
      "duplicate-check-recorded",
      duplicateCheck.id,
      hypothesis,
      now,
    );
    await this.store.save(state);
    return {
      message: `Recorded duplicate assessment ${duplicateCheck.assessment}.`,
      snapshot: this.snapshot(campaign),
    };
  }

  private async reviewHypothesis(
    state: ResearchCampaignState,
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    request: Extract<
      ResearchCampaignCommandRequest,
      { action: "review-hypothesis" }
    >,
  ): Promise<ResearchCampaignCommandResult> {
    const hypothesis = this.requireHypothesis(campaign, request.hypothesisId);
    this.requireHypothesisRevision(hypothesis, request.expectedRevision);
    this.requireMutableHypothesis(hypothesis);
    if (
      !["candidate", "validated-condition", "demonstrated-impact"].includes(
        hypothesis.status,
      )
    ) {
      throw new Error(
        "Only a candidate or stronger non-terminal hypothesis may be reviewed",
      );
    }
    const lease = this.activeLease(hypothesis);
    if (lease)
      throw new Error(
        "Release the active hypothesis lease before independent review",
      );
    if (caller.sessionId === hypothesis.createdBySessionId) {
      throw new Error(
        "A hypothesis creator cannot independently review the same hypothesis",
      );
    }
    const evidence = this.requireEvidenceIds(
      campaign,
      hypothesis,
      request.review.evidenceIds,
    );
    if (
      evidence.some((entry) => entry.producerSessionId !== caller.sessionId)
    ) {
      throw new Error(
        "Independent review must cite evidence produced by the reviewing session",
      );
    }
    const now = this.nowMs();
    hypothesis.reviews.push({
      ...structuredClone(request.review),
      id: randomUUID(),
      reviewerSessionId: caller.sessionId,
      reviewedRevision: hypothesis.revision,
      createdAtMs: now,
    });
    this.touchHypothesis(hypothesis, now);
    this.recordAudit(
      campaign,
      caller,
      "hypothesis-reviewed",
      hypothesis.id,
      hypothesis,
      now,
    );
    await this.store.save(state);
    return {
      message: `Recorded ${request.review.decision} independent review.`,
      snapshot: this.snapshot(campaign),
    };
  }

  private async transitionHypothesis(
    state: ResearchCampaignState,
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    request: Extract<
      ResearchCampaignCommandRequest,
      { action: "transition-hypothesis" }
    >,
  ): Promise<ResearchCampaignCommandResult> {
    this.requireLeader(campaign, caller);
    const hypothesis = this.requireHypothesis(campaign, request.hypothesisId);
    this.requireHypothesisRevision(hypothesis, request.expectedRevision);
    this.requireMutableHypothesis(hypothesis);
    if (this.activeLease(hypothesis)) {
      throw new Error(
        "Release the active hypothesis lease before changing its verdict",
      );
    }
    if (!STATUS_TRANSITIONS[hypothesis.status].has(request.status)) {
      throw new Error(
        `Invalid hypothesis transition ${hypothesis.status} -> ${request.status}`,
      );
    }
    this.assertVerdictGates(campaign, hypothesis, request.status);
    const previous = hypothesis.status;
    const now = this.nowMs();
    hypothesis.status = request.status;
    hypothesis.verdictRationale = request.rationale;
    this.touchHypothesis(hypothesis, now);
    this.recordAudit(
      campaign,
      caller,
      "hypothesis-transitioned",
      hypothesis.id,
      hypothesis,
      now,
    );
    await this.store.save(state);
    return {
      message: `Hypothesis transitioned ${previous} -> ${hypothesis.status}.`,
      snapshot: this.snapshot(campaign),
    };
  }

  private assertVerdictGates(
    campaign: ResearchCampaign,
    hypothesis: ResearchHypothesis,
    status: ResearchHypothesisStatus,
  ): void {
    if (status === "candidate") {
      const material = this.hypothesisEvidence(campaign, hypothesis).some(
        (evidence) => evidence.kind !== "inference",
      );
      if (!material)
        throw new Error("Candidate status requires material evidence");
      return;
    }
    if (status === "validated-condition") {
      this.requireSupports(campaign, hypothesis, VALIDATED_SUPPORTS);
      this.requireRuntimeVerifiedSupports(campaign, hypothesis, [
        "exact-target",
      ]);
      return;
    }
    if (status === "demonstrated-impact") {
      this.requireSupports(campaign, hypothesis, IMPACT_SUPPORTS);
      this.requireRuntimeVerifiedSupports(campaign, hypothesis, [
        "exact-target",
        "realized-effect",
        "negative-control",
        "reproduction",
      ]);
      const confirmed = this.hypothesisExperiments(campaign, hypothesis).some(
        (experiment) =>
          experiment.outcome === "confirmed" &&
          experiment.negativeControl.outcome === "passed",
      );
      if (!confirmed) {
        throw new Error(
          "Demonstrated impact requires a confirmed experiment with a passing negative control",
        );
      }
      return;
    }
    if (status === "reportable") {
      this.requireSupports(campaign, hypothesis, REPORTABLE_SUPPORTS);
      this.requireRuntimeVerifiedSupports(campaign, hypothesis, [
        "exact-target",
        "realized-effect",
        "negative-control",
        "reproduction",
      ]);
      const confirmed = this.hypothesisExperiments(campaign, hypothesis).some(
        (experiment) =>
          experiment.outcome === "confirmed" &&
          experiment.negativeControl.outcome === "passed",
      );
      if (!confirmed) {
        throw new Error(
          "Reportable status requires demonstrated impact and a negative control",
        );
      }
      const duplicateCheck = this.latestDuplicateCheck(campaign, hypothesis);
      if (
        !duplicateCheck ||
        !["no-match", "not-applicable"].includes(duplicateCheck.assessment)
      ) {
        throw new Error(
          "Reportable status requires a latest duplicate assessment of no-match or not-applicable",
        );
      }
      const review = hypothesis.reviews.at(-1);
      if (
        !review ||
        review.decision !== "verified" ||
        !review.blind ||
        review.reviewerSessionId === hypothesis.createdBySessionId ||
        review.reviewedRevision !== hypothesis.revision - 1
      ) {
        throw new Error(
          "Reportable status requires a fresh blind independent verified review of the exact prior revision",
        );
      }
      return;
    }
    if (status === "duplicate-or-known") {
      if (
        this.latestDuplicateCheck(campaign, hypothesis)?.assessment !==
        "duplicate"
      ) {
        throw new Error(
          "Duplicate status requires a recorded duplicate assessment",
        );
      }
    }
  }

  private requireSupports(
    campaign: ResearchCampaign,
    hypothesis: ResearchHypothesis,
    required: readonly ResearchEvidenceSupport[],
  ): void {
    const supports = new Set(
      this.hypothesisEvidence(campaign, hypothesis)
        .filter((evidence) => evidence.kind !== "inference")
        .flatMap((evidence) => evidence.supports),
    );
    const missing = required.filter((support) => !supports.has(support));
    if (missing.length > 0) {
      throw new Error(
        `Verdict evidence is incomplete; missing: ${missing.join(", ")}`,
      );
    }
  }

  private requireRuntimeVerifiedSupports(
    campaign: ResearchCampaign,
    hypothesis: ResearchHypothesis,
    required: readonly ResearchEvidenceSupport[],
  ): void {
    const supports = new Set(
      this.hypothesisEvidence(campaign, hypothesis)
        .filter((evidence) => evidence.verification === "runtime-verified")
        .flatMap((evidence) => evidence.supports),
    );
    const missing = required.filter((support) => !supports.has(support));
    if (missing.length > 0) {
      throw new Error(
        `Runtime-verified evidence is incomplete; missing: ${missing.join(", ")}`,
      );
    }
  }

  private async normalizeAndVerifyTarget(
    target: ResearchTarget,
    scope: ResearchScope,
  ): Promise<ResearchTarget> {
    const normalized = normalizeTarget(target);
    if (!this.ports.verifyArtifact) return normalized;
    normalized.artifacts = await Promise.all(
      normalized.artifacts.map(async (artifact) => {
        if (isWebReference(artifact.reference)) return artifact;
        const actual = await this.ports.verifyArtifact!(
          scope.localRoots,
          artifact.reference,
        );
        assertArtifactIdentity(artifact, actual);
        return {
          ...artifact,
          reference: actual.reference,
          sha256: actual.sha256.toLowerCase(),
          bytes: actual.bytes,
        };
      }),
    );
    return normalized;
  }

  private async verifyEvidence(
    campaign: ResearchCampaign,
    evidence: ResearchEvidenceInput,
  ): Promise<{
    verification: ResearchEvidence["verification"];
    fields: Pick<ResearchEvidenceInput, "reference"> &
      Partial<Pick<ResearchEvidenceInput, "sha256" | "bytes">>;
  }> {
    if (
      ["external-reference", "inference"].includes(evidence.kind) ||
      isWebReference(evidence.reference) ||
      !this.ports.verifyArtifact
    ) {
      return {
        verification: "declared",
        fields: {
          reference: evidence.reference,
          ...(evidence.sha256 ? { sha256: evidence.sha256.toLowerCase() } : {}),
          ...(evidence.bytes === undefined ? {} : { bytes: evidence.bytes }),
        },
      };
    }
    const actual = await this.ports.verifyArtifact(
      campaign.scope.localRoots,
      evidence.reference,
    );
    assertArtifactIdentity(evidence, actual);
    return {
      verification: "runtime-verified",
      fields: {
        reference: actual.reference,
        sha256: actual.sha256.toLowerCase(),
        bytes: actual.bytes,
      },
    };
  }

  private requireOwnedHypothesis(
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    request: { hypothesisId: string; expectedRevision: number },
  ): ResearchHypothesis {
    const hypothesis = this.requireHypothesis(campaign, request.hypothesisId);
    this.requireHypothesisRevision(hypothesis, request.expectedRevision);
    this.requireMutableHypothesis(hypothesis);
    const lease = this.activeLease(hypothesis);
    if (!lease || lease.ownerSessionId !== caller.sessionId) {
      throw new Error("Claim this hypothesis before adding research records");
    }
    return hypothesis;
  }

  private requireEvidenceIds(
    campaign: ResearchCampaign,
    hypothesis: ResearchHypothesis,
    ids: readonly string[],
  ): ResearchEvidence[] {
    return ids.map((id) => {
      const evidence = campaign.evidence.find((entry) => entry.id === id);
      if (!evidence || evidence.hypothesisId !== hypothesis.id) {
        throw new Error(`Evidence ${id} does not belong to this hypothesis`);
      }
      return evidence;
    });
  }

  private hypothesisEvidence(
    campaign: ResearchCampaign,
    hypothesis: ResearchHypothesis,
  ): ResearchEvidence[] {
    return this.requireEvidenceIds(
      campaign,
      hypothesis,
      hypothesis.evidenceIds,
    );
  }

  private hypothesisExperiments(
    campaign: ResearchCampaign,
    hypothesis: ResearchHypothesis,
  ): ResearchExperiment[] {
    return hypothesis.experimentIds.map((id) => {
      const experiment = campaign.experiments.find((entry) => entry.id === id);
      if (!experiment || experiment.hypothesisId !== hypothesis.id) {
        throw new Error(`Experiment ${id} does not belong to this hypothesis`);
      }
      return experiment;
    });
  }

  private latestDuplicateCheck(
    campaign: ResearchCampaign,
    hypothesis: ResearchHypothesis,
  ): ResearchDuplicateCheck | undefined {
    const id = hypothesis.duplicateCheckIds.at(-1);
    if (!id) return undefined;
    const duplicateCheck = campaign.duplicateChecks.find(
      (entry) => entry.id === id,
    );
    if (!duplicateCheck || duplicateCheck.hypothesisId !== hypothesis.id) {
      throw new Error(
        "Latest duplicate check does not belong to this hypothesis",
      );
    }
    return duplicateCheck;
  }

  private activeLease(
    hypothesis: ResearchHypothesis,
  ): ResearchHypothesis["lease"] | undefined {
    return hypothesis.lease && hypothesis.lease.expiresAtMs > this.nowMs()
      ? hypothesis.lease
      : undefined;
  }

  private requireHypothesis(
    campaign: ResearchCampaign,
    hypothesisId: string,
  ): ResearchHypothesis {
    const hypothesis = campaign.hypotheses.find(
      (entry) => entry.id === hypothesisId,
    );
    if (!hypothesis) throw new Error("Security campaign hypothesis not found");
    return hypothesis;
  }

  private requireMutableHypothesis(hypothesis: ResearchHypothesis): void {
    if (TERMINAL_STATUSES.has(hypothesis.status)) {
      throw new Error(`Hypothesis is terminal: ${hypothesis.status}`);
    }
  }

  private requireCampaignRevision(
    campaign: ResearchCampaign,
    expectedRevision: number,
  ): void {
    if (campaign.revision !== expectedRevision) {
      throw new Error(
        "Campaign changed; refresh before applying this mutation",
      );
    }
  }

  private requireHypothesisRevision(
    hypothesis: ResearchHypothesis,
    expectedRevision: number,
  ): void {
    if (hypothesis.revision !== expectedRevision) {
      throw new Error(
        "Hypothesis changed; refresh before applying this mutation",
      );
    }
  }

  private requireLeader(
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
  ): void {
    if (caller.sessionId !== campaign.rootSessionId) {
      throw new Error("Only the campaign leader may perform this operation");
    }
  }

  private requireRootSession(caller: ResearchCampaignSession): void {
    if (caller.parentSessionId || caller.sessionKind === "task") {
      throw new Error("Only a root session may create a security campaign");
    }
  }

  private touchHypothesis(
    hypothesis: ResearchHypothesis,
    now = this.nowMs(),
  ): void {
    hypothesis.revision += 1;
    hypothesis.updatedAtMs = now;
  }

  private recordAudit(
    campaign: ResearchCampaign,
    caller: ResearchCampaignSession,
    action: ResearchAuditAction,
    entityId: string,
    hypothesis?: ResearchHypothesis,
    now = this.nowMs(),
  ): void {
    campaign.revision += 1;
    campaign.updatedAtMs = now;
    campaign.audit.push({
      sequence: campaign.revision,
      atMs: now,
      actorSessionId: caller.sessionId,
      action,
      entityId,
      campaignRevision: campaign.revision,
      ...(hypothesis ? { hypothesisRevision: hypothesis.revision } : {}),
    });
  }

  private visibleCampaigns(
    state: ResearchCampaignState,
    lineage: readonly ResearchCampaignSession[],
  ): ResearchCampaign[] {
    const ancestors = new Set(lineage.map((session) => session.sessionId));
    return state.campaigns
      .filter((campaign) => ancestors.has(campaign.rootSessionId))
      .sort((left, right) => right.createdAtMs - left.createdAtMs);
  }

  private activeCampaign(
    state: ResearchCampaignState,
    lineage: readonly ResearchCampaignSession[],
  ): ResearchCampaign | undefined {
    return this.visibleCampaigns(state, lineage).find(
      (campaign) => campaign.status === "active",
    );
  }

  private async sessionLineage(
    session: ResearchCampaignSession,
  ): Promise<ResearchCampaignSession[]> {
    const lineage: ResearchCampaignSession[] = [];
    const visited = new Set<string>();
    let current: ResearchCampaignSession | undefined = session;
    while (current) {
      if (visited.has(current.sessionId) || visited.size >= 64) {
        throw new Error("Invalid or excessively deep runtime session ancestry");
      }
      visited.add(current.sessionId);
      lineage.push(current);
      if (!current.parentSessionId) break;
      current = await this.requireSession(current.parentSessionId);
    }
    return lineage;
  }

  private async requireSession(
    sessionId: string,
  ): Promise<ResearchCampaignSession> {
    const session = await this.ports.getSession(sessionId);
    if (!session || session.archived) {
      throw new Error("Runtime session not found or archived");
    }
    return session;
  }

  private snapshot(campaign: ResearchCampaign): ResearchCampaign {
    const snapshot = structuredClone(campaign);
    const now = this.nowMs();
    for (const hypothesis of snapshot.hypotheses) {
      if (hypothesis.lease && hypothesis.lease.expiresAtMs <= now) {
        delete hypothesis.lease;
      }
    }
    return snapshot;
  }
}

function normalizeTarget(target: ResearchTarget): ResearchTarget {
  return {
    ...structuredClone(target),
    artifacts: target.artifacts.map((artifact) => ({
      ...structuredClone(artifact),
      sha256: artifact.sha256.toLowerCase(),
    })),
  };
}

function analysisEvidenceKind(
  receipt: AnalysisProducerReceipt,
  artifact: AnalysisReceiptArtifact,
): ResearchEvidence["kind"] {
  if (artifact.role === "root-target") return "original-artifact";
  if (["job", "status", "provenance"].includes(artifact.role)) {
    return "analysis-artifact";
  }
  if (
    receipt.producer.kind === "hypotenuse-job" &&
    artifact.role === "output" &&
    artifact.mediaType === "text/x-java-source"
  ) {
    return "source-reference";
  }
  return "derived-artifact";
}

function analysisEvidenceSummary(
  receipt: AnalysisProducerReceipt,
  artifact: AnalysisReceiptArtifact,
): string {
  const trust =
    artifact.verification === "runtime-verified"
      ? "bytes rehashed by Bari"
      : "identity declared by producer";
  const experiment = receipt.producer.experimental ? "; experimental producer" : "";
  const javaLimit =
    receipt.producer.kind === "hypotenuse-job" &&
    artifact.mediaType === "text/x-java-source"
      ? "; decompiled Java is source-reference evidence, not semantic proof"
      : "";
  return `${receipt.producer.kind} ${artifact.role}; ${trust}${experiment}${javaLimit}`;
}

function analysisEvidenceSupport(
  receipt: AnalysisProducerReceipt,
  artifact: AnalysisReceiptArtifact,
): ResearchEvidenceSupport {
  if (artifact.role === "root-target") return "exact-target";
  if (
    receipt.status === "ok" &&
    receipt.coverage.complete &&
    ["effective-input", "output"].includes(artifact.role)
  ) {
    return "transformations";
  }
  return "analysis-run";
}

function validateEvidenceInput(evidence: ResearchEvidenceInput): void {
  if (
    !["external-reference", "inference"].includes(evidence.kind) &&
    (!evidence.sha256 || evidence.bytes === undefined)
  ) {
    throw new Error("Material evidence requires sha256 and bytes");
  }
}

function assertArtifactIdentity(
  declared: { sha256?: string; bytes?: number },
  actual: { sha256: string; bytes: number },
): void {
  if (
    !declared.sha256 ||
    declared.bytes === undefined ||
    declared.sha256.toLowerCase() !== actual.sha256.toLowerCase() ||
    declared.bytes !== actual.bytes
  ) {
    throw new Error(
      "Material evidence bytes do not match the declared SHA-256 and size",
    );
  }
}

function isWebReference(reference: string): boolean {
  return /^https?:\/\//iu.test(reference.trim());
}

function summarizeCampaign(
  campaign: ResearchCampaign,
): ResearchCampaignSummary {
  const hypothesisCounts: ResearchCampaignSummary["hypothesisCounts"] = {};
  for (const hypothesis of campaign.hypotheses) {
    hypothesisCounts[hypothesis.status] =
      (hypothesisCounts[hypothesis.status] ?? 0) + 1;
  }
  return {
    id: campaign.id,
    revision: campaign.revision,
    title: campaign.title,
    status: campaign.status,
    rootSessionId: campaign.rootSessionId,
    targetName: campaign.target.name,
    hypothesisCounts,
  };
}
