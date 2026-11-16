import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type {
  AnalysisProducerReceiptDraft,
  ResearchCampaignCommandRequest,
  ResearchEvidenceInput,
  ResearchScope,
  ResearchTarget,
} from "./contracts.js";
import { createAnalysisReceiptDigest } from "./analysis-producer/digest.js";
import { isResearchCampaignCommand } from "./schema.js";
import {
  ResearchCampaignService,
  type ResearchCampaignPorts,
  type ResearchCampaignSession,
} from "./service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const target: ResearchTarget = {
  name: "AOSP Private Space URI grants",
  kind: "source",
  identifiers: [
    { kind: "tag", value: "android-security-17.0.0_r2" },
    { kind: "commit", value: "48fe68e00b946ec46b6ecd334e6daf31f5bd65f1" },
  ],
  artifacts: [
    {
      label: "UriGrantsManagerService.java",
      reference:
        "services/core/java/com/android/server/uri/UriGrantsManagerService.java",
      sha256: "a".repeat(64),
      bytes: 1024,
    },
  ],
};

const scope: ResearchScope = {
  program: "Google Android and Devices VRP",
  authorization: "Researcher-owned device and public AOSP source only.",
  allowedActions: ["Static review", "Bounded cross-UID test app"],
  excludedActions: ["Third-party accounts", "Production fuzzing"],
  ruleSources: [
    { url: "https://bughunters.google.com/example", accessedAt: "2026-10-22" },
  ],
  localRoots: ["C:/research/aosp"],
};

const fingerprint = {
  targetFamily: "Android framework",
  attackerPosition: "ordinary app in the primary user",
  trustBoundary: "private profile to primary user",
  primitive: "cross-profile content URI grant",
  privilegedConsumer: "UriGrantsManagerService",
  lifecycle: "private profile stop and unlock",
  impact: "cross-profile data read",
};

async function fixture(portOverrides: Partial<ResearchCampaignPorts> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "bari-security-campaign-"));
  temporaryDirectories.push(directory);
  let now = 1_700_000_000_000;
  const sessions = new Map<string, ResearchCampaignSession>([
    [
      "root",
      {
        sessionId: "root",
        sessionKind: "root",
        status: "idle",
        archived: false,
      },
    ],
    [
      "hunter",
      {
        sessionId: "hunter",
        parentSessionId: "root",
        sessionKind: "task",
        status: "idle",
        archived: false,
      },
    ],
    [
      "reviewer",
      {
        sessionId: "reviewer",
        parentSessionId: "root",
        sessionKind: "task",
        status: "idle",
        archived: false,
      },
    ],
    [
      "hunter-2",
      {
        sessionId: "hunter-2",
        parentSessionId: "root",
        sessionKind: "task",
        status: "idle",
        archived: false,
      },
    ],
    [
      "other",
      {
        sessionId: "other",
        sessionKind: "root",
        status: "idle",
        archived: false,
      },
    ],
  ]);
  const service = new ResearchCampaignService(
    directory,
    {
      getSession: async (sessionId) => sessions.get(sessionId),
      getTeamTask: async (_sessionId, taskId) =>
        taskId === "team-task-1"
          ? {
              rootSessionId: "root",
              task: {
                id: taskId,
                status: "running",
                sessionId: "hunter",
              },
            }
          : undefined,
      verifyArtifact: fakeArtifactVerification,
      ...portOverrides,
    },
    { nowMs: () => now },
  );
  const execute = <T extends Omit<ResearchCampaignCommandRequest, "sessionId">>(
    sessionId: string,
    command: T,
  ) =>
    service.execute({
      ...command,
      sessionId,
    } as ResearchCampaignCommandRequest);
  const tick = (milliseconds = 1) => {
    now += milliseconds;
  };
  await execute("root", {
    action: "create-campaign",
    title: "Private Space URI lifecycle",
    target,
    scope,
  });
  return { directory, sessions, service, execute, tick };
}

async function createHypothesis(
  f: Awaited<ReturnType<typeof fixture>>,
  creator = "root",
) {
  const created = await f.execute(creator, {
    action: "create-hypothesis",
    title: "URI grant survives source profile stop",
    invariant:
      "A recipient must not retain access beyond the authorized profile lifecycle.",
    affectedScope: "Android 17 Private Space on the frozen AOSP tag.",
    fingerprint,
  });
  return created.snapshot!.hypotheses.at(-1)!;
}

function materialEvidence(
  supports: ResearchEvidenceInput["supports"],
  marker = "b",
): ResearchEvidenceInput {
  return {
    kind: "runtime-observation",
    summary: "Bounded observation captured from the exact frozen target.",
    reference: `reports/run-1/observation-${marker}.txt`,
    supports,
    sha256: marker.repeat(64),
    bytes: 512,
    locator: "observation.txt:1",
    tool: "research-lab",
    command: "bounded-test --negative-control",
  };
}

describe("ResearchCampaignService", () => {
  it("freezes target and scope, persists a digest, and exposes only the session lineage", async () => {
    const f = await fixture();
    const status = await f.execute("hunter", { action: "status" });
    expect(status.snapshot).toMatchObject({
      title: "Private Space URI lifecycle",
      rootSessionId: "root",
      status: "active",
      revision: 1,
    });
    expect(status.snapshot?.freezeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      (await f.execute("other", { action: "status" })).snapshot,
    ).toBeUndefined();

    const reopened = new ResearchCampaignService(f.directory, {
      getSession: async (sessionId) => f.sessions.get(sessionId),
    });
    expect(
      (await reopened.execute({ sessionId: "root", action: "status" }))
        .snapshot,
    ).toMatchObject({ freezeDigest: status.snapshot?.freezeDigest });
  });

  it("rejects child campaign creation and multiple active campaigns for one root", async () => {
    const f = await fixture();
    await expect(
      f.execute("hunter", {
        action: "create-campaign",
        title: "nested",
        target,
        scope,
      }),
    ).rejects.toThrow("root session");
    await expect(
      f.execute("root", {
        action: "create-campaign",
        title: "second",
        target,
        scope,
      }),
    ).rejects.toThrow("already has an active");
  });

  it("rejects duplicate root-cause fingerprints instead of assigning parallel work", async () => {
    const f = await fixture();
    await createHypothesis(f);
    await expect(
      f.execute("hunter", {
        action: "create-hypothesis",
        title: "Same cause with different prose",
        invariant: "Same invariant",
        affectedScope: "Same scope",
        fingerprint: {
          ...fingerprint,
          primitive: "  CROSS-PROFILE   content URI grant ",
        },
      }),
    ).rejects.toThrow("fingerprint already exists");
  });

  it("uses optimistic revisions and exclusive expiring leases for research mutations", async () => {
    const f = await fixture();
    const hypothesis = await createHypothesis(f, "hunter");
    const claimed = await f.execute("hunter", {
      action: "claim-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: hypothesis.revision,
      leaseSeconds: 60,
    });
    const revision = claimed.snapshot!.hypotheses[0]!.revision;
    await expect(
      f.execute("reviewer", {
        action: "claim-hypothesis",
        hypothesisId: hypothesis.id,
        expectedRevision: revision,
      }),
    ).rejects.toThrow("leased to session hunter");
    await expect(
      f.execute("hunter", {
        action: "add-evidence",
        hypothesisId: hypothesis.id,
        expectedRevision: hypothesis.revision,
        evidence: materialEvidence(["exact-target"]),
      }),
    ).rejects.toThrow("Hypothesis changed");

    f.tick(60_001);
    const reclaimed = await f.execute("reviewer", {
      action: "claim-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: revision,
    });
    expect(reclaimed.snapshot!.hypotheses[0]!.lease?.ownerSessionId).toBe(
      "reviewer",
    );
  });

  it("links one validated Agent Teams assignment without treating task state as a verdict", async () => {
    const f = await fixture();
    const hypothesis = await createHypothesis(f, "hunter");
    await expect(
      f.execute("reviewer", {
        action: "link-team-task",
        hypothesisId: hypothesis.id,
        expectedRevision: hypothesis.revision,
        teamTaskId: "team-task-1",
      }),
    ).rejects.toThrow("assigned worker");
    const linked = await f.execute("hunter", {
      action: "link-team-task",
      hypothesisId: hypothesis.id,
      expectedRevision: hypothesis.revision,
      teamTaskId: "team-task-1",
    });
    expect(linked.snapshot!.hypotheses[0]).toMatchObject({
      teamTaskId: "team-task-1",
      status: "lead",
    });

    const secondResult = await f.execute("root", {
      action: "create-hypothesis",
      title: "Another root cause",
      invariant: "Different invariant",
      affectedScope: "Different component",
      fingerprint: { ...fingerprint, primitive: "pending intent" },
    });
    const second = secondResult.snapshot!.hypotheses.at(-1)!;
    await expect(
      f.execute("root", {
        action: "link-team-task",
        hypothesisId: second.id,
        expectedRevision: second.revision,
        teamTaskId: "team-task-1",
      }),
    ).rejects.toThrow("already linked");
  });

  it("requires hashes for material evidence and forbids cross-hypothesis evidence references", async () => {
    const f = await fixture();
    const first = await createHypothesis(f, "hunter");
    let status = await f.execute("hunter", {
      action: "claim-hypothesis",
      hypothesisId: first.id,
      expectedRevision: first.revision,
    });
    let current = status.snapshot!.hypotheses[0]!;
    await expect(
      f.execute("hunter", {
        action: "add-evidence",
        hypothesisId: first.id,
        expectedRevision: current.revision,
        evidence: {
          kind: "runtime-observation",
          summary: "Missing durable bytes.",
          reference: "memory-only",
          supports: ["exact-target"],
        },
      }),
    ).rejects.toThrow("requires sha256 and bytes");
    await expect(
      f.execute("hunter", {
        action: "add-evidence",
        hypothesisId: first.id,
        expectedRevision: current.revision,
        evidence: {
          ...materialEvidence(["exact-target"]),
          sha256: "f".repeat(64),
        },
      }),
    ).rejects.toThrow("do not match the declared SHA-256 and size");
    status = await f.execute("hunter", {
      action: "add-evidence",
      hypothesisId: first.id,
      expectedRevision: current.revision,
      evidence: materialEvidence(["exact-target"]),
    });
    const evidenceId = status.snapshot!.evidence[0]!.id;
    current = status.snapshot!.hypotheses[0]!;
    await f.execute("hunter", {
      action: "release-hypothesis",
      hypothesisId: first.id,
      expectedRevision: current.revision,
    });

    const secondResult = await f.execute("root", {
      action: "create-hypothesis",
      title: "Different boundary",
      invariant: "Different invariant",
      affectedScope: "Different scope",
      fingerprint: {
        ...fingerprint,
        trustBoundary: "work profile to personal profile",
      },
    });
    const second = secondResult.snapshot!.hypotheses.at(-1)!;
    status = await f.execute("reviewer", {
      action: "claim-hypothesis",
      hypothesisId: second.id,
      expectedRevision: second.revision,
    });
    await expect(
      f.execute("reviewer", {
        action: "record-experiment",
        hypothesisId: second.id,
        expectedRevision: status.snapshot!.hypotheses.at(-1)!.revision,
        experiment: {
          title: "Cross-reference attempt",
          environment: "test",
          preconditions: [],
          steps: ["run"],
          expectedResult: "blocked",
          observedResult: "blocked",
          outcome: "inconclusive",
          negativeControl: {
            description: "control",
            observedResult: "unchanged",
            outcome: "passed",
          },
          cleanup: "none",
          evidenceIds: [evidenceId],
        },
      }),
    ).rejects.toThrow("does not belong");
  });

  it("fails closed when a persisted frozen scope is modified without updating its digest", async () => {
    const f = await fixture();
    const path = join(f.directory, "v2", "security-campaigns.json");
    const state = JSON.parse(await readFile(path, "utf8")) as {
      campaigns: Array<{ scope: { authorization: string } }>;
    };
    state.campaigns[0]!.scope.authorization = "silently expanded authorization";
    await writeFile(path, `${JSON.stringify(state)}\n`, "utf8");
    await expect(f.execute("root", { action: "status" })).rejects.toThrow(
      "frozen target or scope digest does not match",
    );
  });

  it("migrates version-one campaign state by adding empty analysis receipt collections", async () => {
    const f = await fixture();
    const hypothesis = await createHypothesis(f);
    const path = join(f.directory, "v2", "security-campaigns.json");
    const legacy = JSON.parse(await readFile(path, "utf8")) as {
      version: number;
      campaigns: Array<{
        analysisReceipts?: unknown;
        hypotheses: Array<{ analysisReceiptIds?: unknown }>;
      }>;
    };
    legacy.version = 1;
    delete legacy.campaigns[0]!.analysisReceipts;
    delete legacy.campaigns[0]!.hypotheses[0]!.analysisReceiptIds;
    await writeFile(path, `${JSON.stringify(legacy)}\n`, "utf8");

    const status = await f.execute("root", { action: "status" });
    expect(status.snapshot!.analysisReceipts).toEqual([]);
    expect(status.snapshot!.hypotheses[0]!.analysisReceiptIds).toEqual([]);

    await f.execute("root", {
      action: "claim-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: hypothesis.revision,
    });
    const migrated = JSON.parse(await readFile(path, "utf8")) as {
      version: number;
    };
    expect(migrated.version).toBe(2);
  });

  it("serializes independent service instances without losing disjoint hypothesis evidence", async () => {
    const f = await fixture();
    const first = await createHypothesis(f, "hunter");
    const secondResult = await f.execute("hunter-2", {
      action: "create-hypothesis",
      title: "Different lifecycle edge",
      invariant: "Stopped-profile cleanup must cover delegated grants.",
      affectedScope: "Android 17 profile stop.",
      fingerprint: { ...fingerprint, lifecycle: "full user removal" },
    });
    const second = secondResult.snapshot!.hypotheses.at(-1)!;
    let firstClaim = await f.execute("hunter", {
      action: "claim-hypothesis",
      hypothesisId: first.id,
      expectedRevision: first.revision,
    });
    let secondClaim = await f.execute("hunter-2", {
      action: "claim-hypothesis",
      hypothesisId: second.id,
      expectedRevision: second.revision,
    });

    const reopened = new ResearchCampaignService(
      f.directory,
      {
        getSession: async (sessionId) => f.sessions.get(sessionId),
        verifyArtifact: fakeArtifactVerification,
      },
      { nowMs: () => 1_700_000_000_100 },
    );
    await Promise.all([
      f.execute("hunter", {
        action: "add-evidence",
        hypothesisId: first.id,
        expectedRevision: firstClaim.snapshot!.hypotheses.find(
          (entry) => entry.id === first.id,
        )!.revision,
        evidence: materialEvidence(["exact-target"], "d"),
      }),
      reopened.execute({
        sessionId: "hunter-2",
        action: "add-evidence",
        hypothesisId: second.id,
        expectedRevision: secondClaim.snapshot!.hypotheses.find(
          (entry) => entry.id === second.id,
        )!.revision,
        evidence: materialEvidence(["exact-target"], "e"),
      }),
    ]);
    const campaign = (await f.execute("root", { action: "status" })).snapshot!;
    expect(campaign.evidence).toHaveLength(2);
    expect(
      new Set(campaign.evidence.map((entry) => entry.hypothesisId)),
    ).toEqual(new Set([first.id, second.id]));
  });

  it("does not promote prose or inference through the evidence gates", async () => {
    const f = await fixture();
    const hypothesis = await createHypothesis(f, "hunter");
    let result = await f.execute("hunter", {
      action: "claim-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: hypothesis.revision,
    });
    result = await f.execute("hunter", {
      action: "add-evidence",
      hypothesisId: hypothesis.id,
      expectedRevision: result.snapshot!.hypotheses[0]!.revision,
      evidence: {
        kind: "inference",
        summary: "Readable code seems exploitable.",
        reference: "analyst inference",
        supports: [...VALIDATED_TEST_SUPPORTS],
      },
    });
    result = await f.execute("hunter", {
      action: "release-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: result.snapshot!.hypotheses[0]!.revision,
    });
    await expect(
      f.execute("root", {
        action: "transition-hypothesis",
        hypothesisId: hypothesis.id,
        expectedRevision: result.snapshot!.hypotheses[0]!.revision,
        status: "candidate",
        rationale: "Only inference exists.",
      }),
    ).rejects.toThrow("material evidence");
  });

  it("requires a fresh blind independent review before reportable", async () => {
    const f = await fixture();
    const hypothesis = await createHypothesis(f, "hunter");
    let result = await f.execute("hunter", {
      action: "claim-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: hypothesis.revision,
    });
    result = await f.execute("hunter", {
      action: "add-evidence",
      hypothesisId: hypothesis.id,
      expectedRevision: currentHypothesis(result).revision,
      evidence: materialEvidence([...REPORTABLE_TEST_SUPPORTS]),
    });
    const primaryEvidenceId = result.snapshot!.evidence[0]!.id;
    result = await f.execute("hunter", {
      action: "record-experiment",
      hypothesisId: hypothesis.id,
      expectedRevision: currentHypothesis(result).revision,
      experiment: {
        title: "Cross-profile read lifecycle",
        environment: "Researcher-owned Android device; production build.",
        preconditions: [
          "Private Space configured",
          "Two researcher-owned test apps",
        ],
        steps: [
          "Share URI",
          "Lock Private Space",
          "Retry read",
          "Run negative control",
        ],
        expectedResult:
          "Grant becomes unusable outside the authorized lifecycle.",
        observedResult:
          "Recipient retained the demonstrated effect after the tested transition.",
        outcome: "confirmed",
        negativeControl: {
          description: "Finish recipient activity and retry without a grant.",
          observedResult: "Access was denied.",
          outcome: "passed",
        },
        cleanup: "Removed both test apps and restored Private Space state.",
        evidenceIds: [primaryEvidenceId],
      },
    });
    result = await f.execute("hunter", {
      action: "record-duplicate-check",
      hypothesisId: hypothesis.id,
      expectedRevision: currentHypothesis(result).revision,
      duplicateCheck: {
        searchedSources: ["Android bulletins", "Google VRP disclosures"],
        queries: ["private space uri grant lifecycle privileged consumer"],
        closestMatches: [],
        assessment: "no-match",
        reasoning:
          "No matching root cause and boundary were found in the bounded corpus.",
        evidenceIds: [primaryEvidenceId],
      },
    });
    result = await f.execute("hunter", {
      action: "release-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: currentHypothesis(result).revision,
    });

    for (const status of [
      "candidate",
      "validated-condition",
      "demonstrated-impact",
    ] as const) {
      result = await f.execute("root", {
        action: "transition-hypothesis",
        hypothesisId: hypothesis.id,
        expectedRevision: currentHypothesis(result).revision,
        status,
        rationale: `Evidence gate for ${status} satisfied.`,
      });
    }
    await expect(
      f.execute("root", {
        action: "transition-hypothesis",
        hypothesisId: hypothesis.id,
        expectedRevision: currentHypothesis(result).revision,
        status: "reportable",
        rationale: "Missing independent review.",
      }),
    ).rejects.toThrow("independent verified review");

    result = await f.execute("reviewer", {
      action: "claim-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: currentHypothesis(result).revision,
    });
    result = await f.execute("reviewer", {
      action: "add-evidence",
      hypothesisId: hypothesis.id,
      expectedRevision: currentHypothesis(result).revision,
      evidence: materialEvidence(["reproduction", "negative-control"], "c"),
    });
    const reviewerEvidenceId = result.snapshot!.evidence.at(-1)!.id;
    result = await f.execute("reviewer", {
      action: "release-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: currentHypothesis(result).revision,
    });
    await expect(
      f.execute("hunter", {
        action: "review-hypothesis",
        hypothesisId: hypothesis.id,
        expectedRevision: currentHypothesis(result).revision,
        review: {
          decision: "verified",
          blind: true,
          rationale: "Self-review attempt.",
          evidenceIds: [primaryEvidenceId],
        },
      }),
    ).rejects.toThrow("creator cannot independently review");
    result = await f.execute("reviewer", {
      action: "review-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: currentHypothesis(result).revision,
      review: {
        decision: "verified",
        blind: true,
        rationale:
          "Reproduced independently from the frozen target and experiment contract.",
        evidenceIds: [reviewerEvidenceId],
      },
    });
    result = await f.execute("root", {
      action: "transition-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: currentHypothesis(result).revision,
      status: "reportable",
      rationale:
        "Complete evidence chain, bounded duplicate review, and independent reproduction.",
    });
    expect(currentHypothesis(result).status).toBe("reportable");
    expect(result.snapshot!.audit).toHaveLength(result.snapshot!.revision);
  });

  it("requires an explicit duplicate assessment before a terminal duplicate verdict", async () => {
    const f = await fixture();
    const hypothesis = await createHypothesis(f, "hunter");
    await expect(
      f.execute("root", {
        action: "transition-hypothesis",
        hypothesisId: hypothesis.id,
        expectedRevision: hypothesis.revision,
        status: "duplicate-or-known",
        rationale: "Looks similar.",
      }),
    ).rejects.toThrow("recorded duplicate assessment");
  });

  it("ingests a hash-bound producer receipt without promoting the research verdict", async () => {
    const draft = analysisDraft();
    const f = await fixture({ ingestAnalysisRun: async () => draft });
    let hypothesis = await createHypothesis(f);
    let result = await f.execute("root", {
      action: "claim-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: hypothesis.revision,
    });
    hypothesis = currentHypothesis(result) as typeof hypothesis;
    result = await f.execute("root", {
      action: "ingest-analysis-run",
      hypothesisId: hypothesis.id,
      expectedRevision: hypothesis.revision,
      producer: "hypotenuse-job",
      statusPath: "C:/research/aosp/run.status.json",
    });

    const updated = result.snapshot!.hypotheses[0]!;
    expect(updated.status).toBe("lead");
    expect(result.snapshot!.analysisReceipts).toHaveLength(1);
    expect(result.snapshot!.analysisReceipts[0]).toMatchObject({
      producer: { kind: "hypotenuse-job", experimental: true },
      status: "ok",
      hypothesisId: hypothesis.id,
      ingestedBySessionId: "root",
    });
    expect(updated.analysisReceiptIds).toEqual([
      result.snapshot!.analysisReceipts[0]!.id,
    ]);
    expect(result.snapshot!.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "original-artifact", supports: ["exact-target"] }),
        expect.objectContaining({
          kind: "analysis-artifact",
          tool: "hypotenuse-job",
          supports: ["analysis-run"],
        }),
        expect.objectContaining({
          kind: "source-reference",
          summary: expect.stringContaining("not semantic proof"),
          supports: ["transformations"],
        }),
      ]),
    );
    expect(result.snapshot!.audit.at(-1)?.action).toBe(
      "analysis-receipt-ingested",
    );

    await expect(
      f.execute("root", {
        action: "ingest-analysis-run",
        hypothesisId: hypothesis.id,
        expectedRevision: updated.revision,
        producer: "hypotenuse-job",
        statusPath: "C:/research/aosp/run.status.json",
      }),
    ).rejects.toThrow("already recorded");
  });

  it("rejects a producer receipt for a target outside the frozen campaign", async () => {
    const f = await fixture({
      ingestAnalysisRun: async () => analysisDraft("f".repeat(64)),
    });
    let hypothesis = await createHypothesis(f);
    const claimed = await f.execute("root", {
      action: "claim-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: hypothesis.revision,
    });
    hypothesis = currentHypothesis(claimed) as typeof hypothesis;
    await expect(
      f.execute("root", {
        action: "ingest-analysis-run",
        hypothesisId: hypothesis.id,
        expectedRevision: hypothesis.revision,
        producer: "hypotenuse-job",
        statusPath: "C:/research/aosp/run.status.json",
      }),
    ).rejects.toThrow("frozen campaign artifact");
  });

  it("does not let partial producer output satisfy the transformations verdict gate", async () => {
    const draft = analysisDraft("a".repeat(64), "partial");
    const f = await fixture({ ingestAnalysisRun: async () => draft });
    let hypothesis = await createHypothesis(f);
    const claimed = await f.execute("root", {
      action: "claim-hypothesis",
      hypothesisId: hypothesis.id,
      expectedRevision: hypothesis.revision,
    });
    hypothesis = currentHypothesis(claimed) as typeof hypothesis;
    const result = await f.execute("root", {
      action: "ingest-analysis-run",
      hypothesisId: hypothesis.id,
      expectedRevision: hypothesis.revision,
      producer: "hypotenuse-job",
      statusPath: "C:/research/aosp/run.status.json",
    });
    const derived = result.snapshot!.evidence.filter(
      (entry) => entry.kind !== "original-artifact",
    );
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.every((entry) => entry.supports.includes("analysis-run"))).toBe(
      true,
    );
    expect(derived.some((entry) => entry.supports.includes("transformations"))).toBe(
      false,
    );
  });

  it("validates strict command shapes without caller or credential injection", () => {
    expect(
      isResearchCampaignCommand({
        sessionId: "root",
        action: "status",
        apiKey: "must-not-enter-campaign-state",
      }),
    ).toBe(false);
    expect(
      isResearchCampaignCommand({
        sessionId: "root",
        action: "claim-hypothesis",
        hypothesisId: "hypothesis",
        expectedRevision: 1,
        leaseSeconds: 59,
      }),
    ).toBe(false);
  });
});

function analysisDraft(
  rootSha = "a".repeat(64),
  status: "ok" | "partial" = "ok",
): AnalysisProducerReceiptDraft {
  const rootArtifact = {
    id: "analysis-root",
    role: "root-target" as const,
    reference: "C:/research/aosp/target.apk",
    sha256: rootSha,
    bytes: 1024,
    verification: "runtime-verified" as const,
  };
  const artifacts = [
    rootArtifact,
    {
      id: "analysis-job",
      role: "job" as const,
      reference: "C:/research/aosp/run.hexcore_job.json",
      sha256: "b".repeat(64),
      bytes: 40,
      mediaType: "application/json",
      verification: "runtime-verified" as const,
    },
    {
      id: "analysis-status",
      role: "status" as const,
      reference: "C:/research/aosp/run.status.json",
      sha256: "c".repeat(64),
      bytes: 60,
      mediaType: "application/json",
      verification: "runtime-verified" as const,
    },
    {
      id: "analysis-provenance",
      role: "provenance" as const,
      reference: "C:/research/aosp/run.provenance.json",
      sha256: "d".repeat(64),
      bytes: 80,
      mediaType: "application/json",
      verification: "runtime-verified" as const,
    },
    {
      id: "analysis-output",
      role: "output" as const,
      reference: "C:/research/aosp/Recovered.java",
      sha256: "e".repeat(64),
      bytes: 120,
      mediaType: "text/x-java-source",
      verification: "runtime-verified" as const,
    },
  ];
  const content = {
    schemaVersion: 1 as const,
    producer: {
      kind: "hypotenuse-job" as const,
      contract: "analysis-jobs-v1" as const,
      experimental: true,
      identities: [{ id: "jadx", version: "1.5.6" }],
    },
    status,
    rootTarget: rootArtifact,
    artifacts,
    derivations: [
      {
        outputArtifactId: "analysis-output",
        inputArtifactIds: ["analysis-root"],
        command: "jadx",
        status: "ok" as const,
      },
    ],
    coverage: {
      complete: status === "ok",
      partialReasons: status === "ok" ? [] : ["incomplete producer coverage"],
      totalSteps: 1,
      okSteps: status === "ok" ? 1 : 0,
      partialSteps: status === "partial" ? 1 : 0,
      failedSteps: 0,
      skippedSteps: 0,
    },
    source: {
      statusArtifactId: "analysis-status",
      provenanceArtifactId: "analysis-provenance",
      jobArtifactId: "analysis-job",
      executionId: "execution-1",
    },
    warnings: status === "ok" ? [] : ["incomplete producer coverage"],
  };
  return { ...content, receiptSha256: createAnalysisReceiptDigest(content) };
}

const VALIDATED_TEST_SUPPORTS = [
  "exact-target",
  "attacker-position",
  "controlled-input",
  "transformations",
  "privileged-consumer",
  "constraints-protections",
] as const;

const REPORTABLE_TEST_SUPPORTS = [
  ...VALIDATED_TEST_SUPPORTS,
  "realized-effect",
  "negative-control",
  "reproduction",
  "duplicate-status",
  "affected-scope",
] as const;

function currentHypothesis(result: {
  snapshot?: {
    hypotheses: Array<{ id: string; revision: number; status: string }>;
  };
}) {
  const hypothesis = result.snapshot?.hypotheses[0];
  if (!hypothesis)
    throw new Error("Expected a campaign hypothesis in test result");
  return hypothesis;
}

async function fakeArtifactVerification(
  _roots: readonly string[],
  reference: string,
) {
  if (reference.includes("UriGrantsManagerService.java")) {
    return {
      reference: `C:/research/aosp/${reference}`,
      sha256: "a".repeat(64),
      bytes: 1024,
    };
  }
  const marker = /observation-([a-z])\.txt$/u.exec(reference)?.[1] ?? "b";
  return {
    reference: `C:/research/aosp/${reference}`,
    sha256: marker.repeat(64),
    bytes: 512,
  };
}
