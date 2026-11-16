import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { Value } from "@sinclair/typebox/value";
import lockfile from "proper-lockfile";

import type { ResearchCampaign } from "./contracts.js";
import { createAnalysisReceiptDigest } from "./analysis-producer/digest.js";
import {
  createResearchFingerprint,
  createResearchFreezeDigest,
} from "./fingerprint.js";
import { researchCampaignStateSchema } from "./schema.js";

export interface ResearchCampaignState {
  version: 2;
  campaigns: ResearchCampaign[];
}

const MAX_STATE_BYTES = 32 * 1024 * 1024;
const processLocks = new Map<string, Promise<void>>();

/** Runtime-owned campaign metadata. Evidence bytes stay in user/session artifact roots. */
export class ResearchCampaignStore {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = resolve(join(dataDir, "v2", "security-campaigns.json"));
  }

  async read(): Promise<ResearchCampaignState> {
    try {
      const info = await lstat(this.path);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(
          "Security campaign persistence is not a safe regular file",
        );
      }
      if (info.size > MAX_STATE_BYTES) {
        throw new Error("Security campaign persistence exceeds size limit");
      }
      const value = migrateState(
        JSON.parse(await readFile(this.path, "utf8")) as unknown,
      );
      if (!Value.Check(researchCampaignStateSchema, value)) {
        throw new Error("Invalid security campaign persistence schema");
      }
      const state = value as ResearchCampaignState;
      this.assertInvariants(state);
      return state;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return emptyState();
      throw new Error(
        `Cannot read security campaign persistence: ${describeError(error)}`,
        { cause: error },
      );
    }
  }

  async save(state: ResearchCampaignState): Promise<void> {
    if (!Value.Check(researchCampaignStateSchema, state)) {
      throw new Error("Invalid security campaign state");
    }
    this.assertInvariants(state);
    const body = `${JSON.stringify(state, null, 2)}\n`;
    if (Buffer.byteLength(body) > MAX_STATE_BYTES) {
      throw new Error("Security campaign persistence exceeds size limit");
    }

    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, body, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch((error) => {
        if (!isNodeError(error, "ENOENT")) throw error;
      });
    }
  }

  async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = processLocks.get(this.path) ?? Promise.resolve();
    let release = (): void => {};
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = previous.then(() => gate);
    processLocks.set(this.path, tail);
    await previous;

    let unlock: (() => Promise<void>) | undefined;
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      unlock = await lockfile.lock(this.path, {
        realpath: false,
        stale: 30_000,
        retries: { retries: 30, minTimeout: 50, maxTimeout: 500 },
      });
      return await operation();
    } finally {
      try {
        await unlock?.();
      } finally {
        release();
        if (processLocks.get(this.path) === tail)
          processLocks.delete(this.path);
      }
    }
  }

  private assertInvariants(state: ResearchCampaignState): void {
    assertUnique(
      state.campaigns.map((campaign) => campaign.id),
      "campaign id",
    );

    const activeRoots = state.campaigns
      .filter((campaign) => campaign.status === "active")
      .map((campaign) => campaign.rootSessionId);
    assertUnique(activeRoots, "active campaign root");

    for (const campaign of state.campaigns) this.assertCampaign(campaign);
  }

  private assertCampaign(campaign: ResearchCampaign): void {
    if (
      createResearchFreezeDigest(campaign.target, campaign.scope) !==
      campaign.freezeDigest
    ) {
      throw new Error(
        "Security campaign frozen target or scope digest does not match",
      );
    }
    if (campaign.updatedAtMs < campaign.createdAtMs) {
      throw new Error("Security campaign update predates creation");
    }
    if (campaign.audit.length !== campaign.revision) {
      throw new Error(
        "Security campaign revision does not match its audit length",
      );
    }
    campaign.audit.forEach((event, index) => {
      const expected = index + 1;
      if (event.sequence !== expected || event.campaignRevision !== expected) {
        throw new Error("Security campaign audit sequence is not contiguous");
      }
    });
    const latestEvent = campaign.audit.at(-1);
    if (!latestEvent || latestEvent.atMs !== campaign.updatedAtMs) {
      throw new Error(
        "Security campaign audit does not describe the latest update",
      );
    }

    assertUnique(
      campaign.target.identifiers.map(
        (entry) => `${entry.kind}\0${entry.value}`,
      ),
      "target identifier",
    );
    assertUnique(
      campaign.target.artifacts.map((artifact) => artifact.reference),
      "target artifact reference",
    );
    assertUnique(
      campaign.target.artifacts.map((artifact) =>
        artifact.sha256.toLowerCase(),
      ),
      "target artifact digest",
    );

    assertUnique(
      campaign.hypotheses.map((hypothesis) => hypothesis.id),
      "hypothesis id",
    );
    assertUnique(
      campaign.hypotheses.map((hypothesis) => hypothesis.fingerprint.key),
      "hypothesis fingerprint",
    );
    assertUnique(
      campaign.hypotheses.flatMap((hypothesis) =>
        hypothesis.teamTaskId ? [hypothesis.teamTaskId] : [],
      ),
      "linked team task",
    );
    assertUnique(
      campaign.evidence.map((evidence) => evidence.id),
      "evidence id",
    );
    assertUnique(
      campaign.analysisReceipts.map((receipt) => receipt.id),
      "analysis receipt id",
    );
    assertUnique(
      campaign.analysisReceipts.map((receipt) => receipt.receiptSha256),
      "analysis receipt digest",
    );
    assertUnique(
      campaign.experiments.map((experiment) => experiment.id),
      "experiment id",
    );
    assertUnique(
      campaign.duplicateChecks.map((duplicateCheck) => duplicateCheck.id),
      "duplicate-check id",
    );

    const hypotheses = new Map(
      campaign.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]),
    );
    const evidence = new Map(
      campaign.evidence.map((entry) => [entry.id, entry]),
    );
    const analysisReceipts = new Map(
      campaign.analysisReceipts.map((entry) => [entry.id, entry]),
    );
    const experiments = new Map(
      campaign.experiments.map((entry) => [entry.id, entry]),
    );
    const duplicateChecks = new Map(
      campaign.duplicateChecks.map((entry) => [entry.id, entry]),
    );

    for (const hypothesis of campaign.hypotheses) {
      const expectedFingerprint = createResearchFingerprint(
        hypothesis.fingerprint,
      );
      if (expectedFingerprint.key !== hypothesis.fingerprint.key) {
        throw new Error(
          "Hypothesis fingerprint does not match its canonical fields",
        );
      }
      if (hypothesis.updatedAtMs < hypothesis.createdAtMs) {
        throw new Error("Hypothesis update predates creation");
      }
      if (
        hypothesis.lease &&
        hypothesis.lease.expiresAtMs <= hypothesis.lease.claimedAtMs
      ) {
        throw new Error("Hypothesis lease has an invalid lifetime");
      }
      for (const evidenceId of hypothesis.evidenceIds) {
        const entry = evidence.get(evidenceId);
        if (!entry || entry.hypothesisId !== hypothesis.id) {
          throw new Error("Hypothesis references invalid evidence");
        }
      }
      for (const receiptId of hypothesis.analysisReceiptIds) {
        const receipt = analysisReceipts.get(receiptId);
        if (!receipt || receipt.hypothesisId !== hypothesis.id) {
          throw new Error("Hypothesis references an invalid analysis receipt");
        }
      }
      for (const experimentId of hypothesis.experimentIds) {
        const entry = experiments.get(experimentId);
        if (!entry || entry.hypothesisId !== hypothesis.id) {
          throw new Error("Hypothesis references an invalid experiment");
        }
      }
      for (const duplicateCheckId of hypothesis.duplicateCheckIds) {
        const entry = duplicateChecks.get(duplicateCheckId);
        if (!entry || entry.hypothesisId !== hypothesis.id) {
          throw new Error("Hypothesis references an invalid duplicate check");
        }
      }
      assertUnique(
        hypothesis.reviews.map((review) => review.id),
        "hypothesis review id",
      );
      for (const review of hypothesis.reviews) {
        if (review.reviewedRevision >= hypothesis.revision) {
          throw new Error("Hypothesis review revision is not historical");
        }
        assertEvidenceReferences(review.evidenceIds, evidence, hypothesis.id);
      }
    }

    for (const entry of campaign.evidence) {
      if (!hypotheses.has(entry.hypothesisId)) {
        throw new Error("Evidence references an unknown hypothesis");
      }
      if (
        requiresDigest(entry.kind) &&
        (!entry.sha256 || entry.bytes === undefined)
      ) {
        throw new Error("Material evidence requires a digest and byte count");
      }
      if (
        entry.verification === "runtime-verified" &&
        entry.verifiedAtMs === undefined
      ) {
        throw new Error(
          "Runtime-verified evidence is missing its verification time",
        );
      }
      if (
        entry.verification === "declared" &&
        entry.verifiedAtMs !== undefined
      ) {
        throw new Error(
          "Declared evidence cannot carry a runtime verification time",
        );
      }
    }
    for (const receipt of campaign.analysisReceipts) {
      if (!hypotheses.has(receipt.hypothesisId)) {
        throw new Error("Analysis receipt references an unknown hypothesis");
      }
      if (createAnalysisReceiptDigest(receipt) !== receipt.receiptSha256) {
        throw new Error("Analysis receipt digest does not match its content");
      }
      if (
        receipt.producer.experimental !==
        (receipt.producer.kind === "hypotenuse-job")
      ) {
        throw new Error("Analysis producer experimental marker is invalid");
      }
      if (
        !campaign.target.artifacts.some(
          (artifact) =>
            artifact.sha256.toLowerCase() === receipt.rootTarget.sha256.toLowerCase(),
        )
      ) {
        throw new Error("Analysis receipt root target is not frozen in the campaign");
      }
      assertAnalysisReceipt(receipt);
    }
    for (const experiment of campaign.experiments) {
      if (!hypotheses.has(experiment.hypothesisId)) {
        throw new Error("Experiment references an unknown hypothesis");
      }
      assertEvidenceReferences(
        experiment.evidenceIds,
        evidence,
        experiment.hypothesisId,
      );
    }
    for (const duplicateCheck of campaign.duplicateChecks) {
      if (!hypotheses.has(duplicateCheck.hypothesisId)) {
        throw new Error("Duplicate check references an unknown hypothesis");
      }
      assertEvidenceReferences(
        duplicateCheck.evidenceIds,
        evidence,
        duplicateCheck.hypothesisId,
      );
    }
  }
}

function emptyState(): ResearchCampaignState {
  return { version: 2, campaigns: [] };
}

function migrateState(value: unknown): unknown {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.campaigns)) {
    return value;
  }
  return {
    ...value,
    version: 2,
    campaigns: value.campaigns.map((rawCampaign) => {
      if (!isRecord(rawCampaign)) return rawCampaign;
      return {
        ...rawCampaign,
        analysisReceipts: Array.isArray(rawCampaign.analysisReceipts)
          ? rawCampaign.analysisReceipts
          : [],
        hypotheses: Array.isArray(rawCampaign.hypotheses)
          ? rawCampaign.hypotheses.map((rawHypothesis) =>
              isRecord(rawHypothesis)
                ? {
                    ...rawHypothesis,
                    analysisReceiptIds: Array.isArray(
                      rawHypothesis.analysisReceiptIds,
                    )
                      ? rawHypothesis.analysisReceiptIds
                      : [],
                  }
                : rawHypothesis,
            )
          : rawCampaign.hypotheses,
      };
    }),
  };
}

function assertAnalysisReceipt(
  receipt: ResearchCampaign["analysisReceipts"][number],
): void {
  assertUnique(
    receipt.artifacts.map((artifact) => artifact.id),
    "analysis artifact id",
  );
  const artifacts = new Map(
    receipt.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const root = artifacts.get(receipt.rootTarget.id);
  if (
    !root ||
    root.role !== "root-target" ||
    root.sha256 !== receipt.rootTarget.sha256 ||
    root.reference !== receipt.rootTarget.reference
  ) {
    throw new Error("Analysis receipt root target is not a canonical artifact");
  }
  requireAnalysisArtifactRole(
    artifacts,
    receipt.source.statusArtifactId,
    "status",
  );
  requireAnalysisArtifactRole(
    artifacts,
    receipt.source.provenanceArtifactId,
    "provenance",
  );
  if (receipt.source.jobArtifactId) {
    requireAnalysisArtifactRole(artifacts, receipt.source.jobArtifactId, "job");
  }
  for (const derivation of receipt.derivations) {
    requireAnalysisArtifactRole(artifacts, derivation.outputArtifactId, "output");
    for (const inputId of derivation.inputArtifactIds) {
      const input = artifacts.get(inputId);
      if (!input || !["root-target", "effective-input"].includes(input.role)) {
        throw new Error("Analysis derivation references an invalid input artifact");
      }
    }
  }
  const countedSteps =
    receipt.coverage.okSteps +
    receipt.coverage.partialSteps +
    receipt.coverage.failedSteps +
    receipt.coverage.skippedSteps;
  if (countedSteps !== receipt.coverage.totalSteps) {
    throw new Error("Analysis receipt coverage counters are inconsistent");
  }
  const shouldBeComplete =
    receipt.status === "ok" && receipt.coverage.partialReasons.length === 0;
  if (receipt.coverage.complete !== shouldBeComplete) {
    throw new Error("Analysis receipt completeness is inconsistent with status");
  }
}

function requireAnalysisArtifactRole(
  artifacts: ReadonlyMap<
    string,
    ResearchCampaign["analysisReceipts"][number]["artifacts"][number]
  >,
  id: string,
  role: ResearchCampaign["analysisReceipts"][number]["artifacts"][number]["role"],
): void {
  if (artifacts.get(id)?.role !== role) {
    throw new Error(`Analysis receipt references an invalid ${role} artifact`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate security campaign ${label}`);
  }
}

function assertEvidenceReferences(
  ids: readonly string[],
  evidence: ReadonlyMap<string, { hypothesisId: string }>,
  hypothesisId: string,
): void {
  for (const id of ids) {
    const entry = evidence.get(id);
    if (!entry || entry.hypothesisId !== hypothesisId) {
      throw new Error("Record references evidence from another hypothesis");
    }
  }
}

function requiresDigest(kind: string): boolean {
  return !["external-reference", "inference"].includes(kind);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}
