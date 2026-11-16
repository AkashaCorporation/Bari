import { describe, expect, it, vi } from "vitest";

import type {
  ResearchCampaign,
  ResearchCampaignCommandResult,
} from "@bari/local-runtime-v2/cli-service";

import { stripAnsi } from "../../src/tui/rendering/text.js";
import {
  TuiResearchCampaignPanel,
  type TuiResearchCampaignAction,
} from "../../src/tui/security-campaign/panel.js";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function campaign(): ResearchCampaign {
  return {
    id: "campaign-1",
    revision: 7,
    rootSessionId: "root",
    title: "Private Space URI lifecycle",
    status: "active",
    target: {
      name: "AOSP Private Space",
      kind: "source",
      identifiers: [{ kind: "commit", value: "48fe68e" }],
      artifacts: [],
    },
    scope: {
      program: "Google Android VRP",
      authorization: "Researcher-owned device",
      allowedActions: ["Static review"],
      excludedActions: ["Production fuzzing"],
      ruleSources: [],
      localRoots: [],
    },
    freezeDigest: "a".repeat(64),
    createdAtMs: 1,
    updatedAtMs: 7,
    hypotheses: [
      {
        id: "hypothesis-1",
        revision: 4,
        title: "Grant lifecycle",
        invariant: "Private profile data remains isolated.",
        affectedScope: "Android 17",
        fingerprint: {
          targetFamily: "android",
          attackerPosition: "ordinary app",
          trustBoundary: "private to primary",
          primitive: "uri grant",
          privilegedConsumer: "uri service",
          lifecycle: "profile stop",
          impact: "data read",
          key: "b".repeat(64),
        },
        status: "candidate",
        createdBySessionId: "hunter",
        createdAtMs: 2,
        updatedAtMs: 6,
        evidenceIds: ["evidence-1"],
        analysisReceiptIds: ["analysis-1"],
        experimentIds: [],
        duplicateCheckIds: [],
        reviews: [],
      },
    ],
    evidence: [
      {
        id: "evidence-1",
        hypothesisId: "hypothesis-1",
        producerSessionId: "hunter",
        createdAtMs: 3,
        kind: "source-reference",
        summary: "Exact source path",
        reference: "frameworks/base/File.java",
        locator: "File.java:42",
        supports: ["exact-target"],
        sha256: "c".repeat(64),
        bytes: 100,
        verification: "runtime-verified",
        verifiedAtMs: 3,
      },
    ],
    analysisReceipts: [
      {
        schemaVersion: 1,
        producer: {
          kind: "hypotenuse-job",
          contract: "analysis-jobs-v1",
          experimental: true,
          identities: [{ id: "jadx", version: "1.5.6" }],
        },
        status: "partial",
        rootTarget: {
          id: "root-artifact",
          role: "root-target",
          reference: "target.apk",
          sha256: "d".repeat(64),
          bytes: 100,
          verification: "runtime-verified",
        },
        artifacts: [
          {
            id: "root-artifact",
            role: "root-target",
            reference: "target.apk",
            sha256: "d".repeat(64),
            bytes: 100,
            verification: "runtime-verified",
          },
          {
            id: "effective-artifact",
            role: "effective-input",
            reference: "classes.dex",
            sha256: "e".repeat(64),
            verification: "declared",
          },
          {
            id: "status-artifact",
            role: "status",
            reference: "run.status.json",
            sha256: "f".repeat(64),
            verification: "runtime-verified",
          },
          {
            id: "provenance-artifact",
            role: "provenance",
            reference: "run.provenance.json",
            sha256: "1".repeat(64),
            verification: "runtime-verified",
          },
        ],
        derivations: [],
        coverage: {
          complete: false,
          partialReasons: ["effective input unavailable"],
          totalSteps: 1,
          okSteps: 0,
          partialSteps: 1,
          failedSteps: 0,
          skippedSteps: 0,
        },
        source: {
          statusArtifactId: "status-artifact",
          provenanceArtifactId: "provenance-artifact",
        },
        warnings: ["effective input unavailable"],
        receiptSha256: "2".repeat(64),
        id: "analysis-1",
        hypothesisId: "hypothesis-1",
        ingestedBySessionId: "hunter",
        ingestedAtMs: 6,
      },
    ],
    experiments: [],
    duplicateChecks: [],
    audit: Array.from({ length: 7 }, (_, index) => ({
      sequence: index + 1,
      atMs: index + 1,
      actorSessionId: "root",
      action: index === 0 ? "campaign-created" : "hypothesis-claimed",
      entityId: index === 0 ? "campaign-1" : "hypothesis-1",
      campaignRevision: index + 1,
      ...(index === 0 ? {} : { hypothesisRevision: Math.min(index, 4) }),
    })),
  };
}

function text(panel: TuiResearchCampaignPanel): string {
  return stripAnsi(panel.render(180).join("\n"));
}

async function choose(
  panel: TuiResearchCampaignPanel,
  label: string,
): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (text(panel).includes(`> ${label}`)) {
      panel.handleInput("\r");
      await settle();
      return;
    }
    panel.handleInput("\u001b[B");
  }
  throw new Error(`No selectable item ${label}: ${text(panel)}`);
}

function harness() {
  const snapshot = campaign();
  const execute = vi.fn(
    async (
      _action: TuiResearchCampaignAction,
    ): Promise<ResearchCampaignCommandResult> => ({
      message: "Updated",
      snapshot,
      campaigns: [],
    }),
  );
  const onCancel = vi.fn();
  const panel = new TuiResearchCampaignPanel({
    initial: { message: "Loaded", snapshot, campaigns: [] },
    execute,
    onCancel,
    requestRender: vi.fn(),
  });
  panel.focused = true;
  return { panel, execute, onCancel, snapshot };
}

describe("security campaign keyboard panel", () => {
  it("shows the immutable target digest and keeps runtime state distinct from verdicts", () => {
    const h = harness();
    expect(text(h.panel)).toContain("Freeze SHA-256");
    expect(text(h.panel)).toContain("AOSP Private Space");
    expect(text(h.panel)).toContain("[CANDIDATE] Grant lifecycle");
    expect(text(h.panel)).toContain("Runtime status is not a verdict");
  });

  it("opens hypothesis evidence with exact locators", async () => {
    const h = harness();
    await choose(h.panel, "[CANDIDATE] Grant lifecycle");
    expect(text(h.panel)).toContain("frameworks/base/File.java @ File.java:42");
    expect(text(h.panel)).toContain("Fingerprint:");
    expect(text(h.panel)).toContain("Evidence: 1");
  });

  it("shows producer trust, root identity and partial coverage", async () => {
    const h = harness();
    await choose(h.panel, "[CANDIDATE] Grant lifecycle");
    const rendered = text(h.panel);
    expect(rendered).toContain("[ANALYSIS PARTIAL · EXPERIMENTAL] hypotenuse-job");
    expect(rendered).toContain("effective inputs eeeeeeeeeeee…eeee:declared");
    expect(rendered).toContain("partial: effective input unavailable");
  });

  it("archives the exact displayed campaign revision after explicit confirmation", async () => {
    const h = harness();
    await choose(h.panel, "Archive campaign");
    await choose(h.panel, "Confirm archive");
    expect(h.execute).toHaveBeenCalledWith({
      action: "archive-campaign",
      expectedRevision: 7,
    });
  });

  it("prevents repeated archive mutations while a request is in flight", async () => {
    const h = harness();
    await choose(h.panel, "Archive campaign");
    let release!: () => void;
    h.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ message: "Archived", snapshot: h.snapshot });
        }),
    );
    h.panel.handleInput("\u001b[B");
    h.panel.handleInput("\r");
    h.panel.handleInput("\r");
    expect(h.execute).toHaveBeenCalledTimes(1);
    release();
    await settle();
  });

  it("sanitizes campaign and hypothesis text before terminal rendering", () => {
    const h = harness();
    h.snapshot.title = "Campaign\u001b[2J";
    h.snapshot.hypotheses[0]!.title = "Hypothesis\u001b[31m";
    expect(h.panel.render(100).join("\n")).not.toContain("\u001b[2J");
    expect(h.panel.render(100).join("\n")).not.toContain("\u001b[31m");
  });
});
