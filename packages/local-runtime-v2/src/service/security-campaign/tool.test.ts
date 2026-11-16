import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeTool, ToolResult } from "@bari/agent-core/tools";

import { buildLocalTurnToolCatalog } from "../turn-system/agent-host/assembly/local-turn-tool-catalog.js";
import { ResearchCampaignService } from "./service.js";
import { createResearchCampaignTool } from "./tool.js";

function fixture() {
  const service = new ResearchCampaignService("unused-test-directory", {
    getSession: async () => undefined,
  });
  const execute = vi
    .spyOn(service, "execute")
    .mockResolvedValue({ message: "campaign status" });
  return { service, execute };
}

function catalog(
  service: ResearchCampaignService,
  role = "mavis",
  selection?: { tools?: string[]; disallowedTools?: string[] },
) {
  return buildLocalTurnToolCatalog({
    sessionId: "root",
    llmModel: { provider: "test", id: "small", contextWindow: 8_000 },
    sources: {
      nativeTools: [createResearchCampaignTool(service, "root")],
      mcpEntries: [],
      threadGoalTools: [],
      cuRuntimeAvailable: false,
    },
    agentProfile: {
      trustedBuiltin: true,
      canonicalRole: role,
      surface: "cli" as const,
      capabilityCeiling: {
        features: { mavis: true, delegation: true, webSearch: true },
      },
      ...(selection ? { configSelection: selection } : {}),
    },
  });
}

async function invoke(
  tool: RuntimeTool,
  command: Record<string, unknown>,
): Promise<ToolResult> {
  return tool.impl.execute({ sessionId: "root", turnId: "turn" }, { command });
}

describe("research_coordination tool policy", () => {
  it("publishes strict commands without a model-controlled caller identity", async () => {
    const f = fixture();
    const tool = catalog(f.service).tools.find(
      (candidate) => candidate.def.name === "research_coordination",
    )!;
    expect(
      Value.Check(tool.def.schema, { command: { action: "status" } }),
    ).toBe(true);
    expect(
      Value.Check(tool.def.schema, {
        command: { action: "status", sessionId: "spoofed" },
      }),
    ).toBe(false);
    await invoke(tool, { action: "status" });
    expect(f.execute).toHaveBeenCalledExactlyOnceWith({
      action: "status",
      sessionId: "root",
    });
  });

  it("gives verifier sessions append/review access without leader verdict authority", async () => {
    const f = fixture();
    const tool = catalog(f.service, "verifier").tools.find(
      (candidate) => candidate.def.name === "research_coordination",
    )!;
    expect((await invoke(tool, { action: "status" })).isError).not.toBe(true);
    const mutation = await invoke(tool, {
      action: "archive-campaign",
      expectedRevision: 1,
    });
    expect(mutation.isError).toBe(true);
    expect(mutation.text).toContain(
      "access verify cannot perform archive-campaign",
    );
    const review = await invoke(tool, {
      action: "review-hypothesis",
      hypothesisId: "hypothesis",
      expectedRevision: 3,
      review: {
        decision: "verified",
        blind: true,
        rationale: "Independent reproduction",
        evidenceIds: ["evidence"],
      },
    });
    expect(review.isError).not.toBe(true);
    const receipt = await invoke(tool, {
      action: "ingest-analysis-run",
      hypothesisId: "hypothesis",
      expectedRevision: 3,
      producer: "hexcore-job",
      statusPath: "C:/research/run.status.json",
    });
    expect(receipt.isError).not.toBe(true);
    expect(f.execute).toHaveBeenCalledTimes(3);
  });

  it("keeps explore sessions observation-only", async () => {
    const f = fixture();
    const tool = catalog(f.service, "explore").tools.find(
      (candidate) => candidate.def.name === "research_coordination",
    )!;
    const mutation = await invoke(tool, {
      action: "claim-hypothesis",
      hypothesisId: "hypothesis",
      expectedRevision: 1,
    });
    expect(mutation.isError).toBe(true);
    expect(mutation.text).toContain(
      "access observe cannot perform claim-hypothesis",
    );
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("honors the canonical tool selector and does not bypass an explicit denial", () => {
    const f = fixture();
    const unrelated: RuntimeTool = {
      def: { name: "other", description: "other", schema: Type.Object({}) },
      impl: {
        execute: async () => ({ tool_name: "other", text: "", content: [] }),
      },
    };
    const selected = buildLocalTurnToolCatalog({
      sessionId: "root",
      llmModel: { provider: "test", id: "small", contextWindow: 8_000 },
      sources: {
        nativeTools: [unrelated, createResearchCampaignTool(f.service, "root")],
        mcpEntries: [],
        threadGoalTools: [],
        cuRuntimeAvailable: false,
      },
      agentProfile: {
        trustedBuiltin: true,
        canonicalRole: "mavis",
        surface: "cli",
        capabilityCeiling: {
          features: { mavis: true, delegation: true, webSearch: true },
        },
        configSelection: { disallowedTools: ["research_coordination"] },
      },
    });
    expect(
      selected.tools.some((tool) => tool.def.name === "research_coordination"),
    ).toBe(false);
  });

  it("redacts sensitive evidence metadata from provider-visible tool output", async () => {
    const f = fixture();
    f.execute.mockResolvedValueOnce({
      message: "status",
      snapshot: {
        evidence: [
          {
            id: "evidence",
            sensitive: true,
            summary: "private researcher note",
            reference: "C:/private/proof.txt",
            locator: "secret:1",
            command: "sensitive command",
          },
        ],
      },
    } as never);
    const tool = catalog(f.service).tools.find(
      (candidate) => candidate.def.name === "research_coordination",
    )!;
    const result = await invoke(tool, { action: "status" });
    expect(result.text).toContain("sensitive://redacted");
    expect(result.text).not.toContain("private researcher note");
    expect(result.text).not.toContain("C:/private/proof.txt");
    expect(result.text).not.toContain("sensitive command");
  });
});
