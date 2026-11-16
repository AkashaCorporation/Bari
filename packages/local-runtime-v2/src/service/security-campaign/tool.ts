import { Type } from "@sinclair/typebox";

import type { RuntimeTool } from "@bari/agent-core/tools";

import type { ResearchCampaignService } from "./service.js";
import type { ResearchCampaignCommandResult } from "./contracts.js";
import {
  isResearchCampaignCommand,
  researchCampaignCommandSchema,
} from "./schema.js";

export type ResearchCampaignToolAccess = "observe" | "verify" | "full";

const binders = new WeakMap<
  RuntimeTool,
  (access: ResearchCampaignToolAccess) => RuntimeTool
>();
const OBSERVE_ACTIONS = new Set(["list", "status"]);
const VERIFY_ACTIONS = new Set([
  ...OBSERVE_ACTIONS,
  "claim-hypothesis",
  "release-hypothesis",
  "add-evidence",
  "ingest-analysis-run",
  "record-experiment",
  "record-duplicate-check",
  "review-hypothesis",
]);

/** Applies the canonical read-only Agent role after tool selection has settled. */
export function bindResearchCampaignToolPolicy(
  tool: RuntimeTool,
  access: ResearchCampaignToolAccess,
): RuntimeTool {
  return binders.get(tool)?.(access) ?? tool;
}

export function createResearchCampaignTool(
  service: ResearchCampaignService,
  sessionId: string,
): RuntimeTool {
  const build = (access: ResearchCampaignToolAccess): RuntimeTool => ({
    def: {
      name: "research_coordination",
      executionMode: "sequential",
      description:
        "Coordinate an authorized security research campaign over a runtime-bound session lineage. The campaign freezes target/scope, rejects duplicate root-cause fingerprints, leases hypotheses, validates links to Agent Teams tasks, ingests hash-revalidated HexCore or experimental Hypotenuse Jobs receipts, stores immutable evidence/experiments/duplicate checks, and gates verdict transitions. Start with status/list. Caller identity and timestamps are bound by Runtime; never provide sessionId. Analysis receipts never promote a verdict by themselves. Reportable requires complete evidence, confirmed impact with a passing negative control, a non-duplicate assessment, and a fresh blind independent review.",
      schema: Type.Object(
        {
          command: Type.Union(
            researchCampaignCommandSchema.anyOf.map((schema) =>
              Type.Omit(schema, ["sessionId"]),
            ),
          ),
        },
        { additionalProperties: false },
      ),
    },
    impl: {
      execute: async (_context, input) => {
        try {
          const raw = input as { command?: unknown };
          const candidate =
            raw.command && typeof raw.command === "object"
              ? { ...(raw.command as Record<string, unknown>), sessionId }
              : raw.command;
          if (!isResearchCampaignCommand(candidate)) {
            throw new Error("Invalid security campaign command");
          }
          if (!actionAllowed(access, candidate.action)) {
            throw new Error(
              `Agent campaign access ${access} cannot perform ${candidate.action}`,
            );
          }
          const result = redactSensitiveEvidence(
            await service.execute(candidate),
          );
          const text = JSON.stringify(result);
          return {
            tool_name: "research_coordination",
            text,
            content: [{ type: "text" as const, text }],
          };
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          return {
            tool_name: "research_coordination",
            text,
            content: [{ type: "text" as const, text }],
            isError: true,
          };
        }
      },
    },
  });

  const tool = build("observe");
  binders.set(tool, build);
  return tool;
}

function actionAllowed(
  access: ResearchCampaignToolAccess,
  action: string,
): boolean {
  if (access === "full") return true;
  return (access === "verify" ? VERIFY_ACTIONS : OBSERVE_ACTIONS).has(action);
}

function redactSensitiveEvidence(
  result: ResearchCampaignCommandResult,
): ResearchCampaignCommandResult {
  if (
    !result.snapshot?.evidence.some((evidence) => evidence.sensitive === true)
  ) {
    return result;
  }
  const snapshot = structuredClone(result.snapshot);
  snapshot.evidence = snapshot.evidence.map((evidence) => {
    if (evidence.sensitive !== true) return evidence;
    const redacted = {
      ...evidence,
      summary: "[sensitive evidence metadata redacted from model output]",
      reference: "sensitive://redacted",
    };
    delete redacted.locator;
    delete redacted.tool;
    delete redacted.command;
    return redacted;
  });
  return { ...result, snapshot };
}
