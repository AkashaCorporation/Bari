import { describe, expect, it, vi } from "vitest";

import type { ResearchCampaignCommandRequest } from "@bari/local-runtime-v2/cli-service";

import { TuiRuntimeAdapter } from "../../src/runtime/adapter.js";

describe("security campaign Runtime adapter", () => {
  it("forwards the exact typed request to the CliService facade", async () => {
    const response = { message: "Current campaign" };
    const executeResearchCampaignCommand = vi.fn(async () => response);
    const adapter = new TuiRuntimeAdapter({
      executeResearchCampaignCommand,
    } as never);
    const request: ResearchCampaignCommandRequest = {
      action: "status",
      sessionId: "root",
    };
    await expect(adapter.executeResearchCampaignCommand(request)).resolves.toBe(
      response,
    );
    expect(executeResearchCampaignCommand).toHaveBeenCalledExactlyOnceWith(
      request,
    );
  });

  it("does not translate a runtime verdict denial into success", async () => {
    const adapter = new TuiRuntimeAdapter({
      executeResearchCampaignCommand: vi.fn(async () => {
        throw new Error("Evidence gate incomplete");
      }),
    } as never);
    await expect(
      adapter.executeResearchCampaignCommand({
        action: "status",
        sessionId: "root",
      }),
    ).rejects.toThrow("Evidence gate incomplete");
  });

  it("reports an unavailable capability for older hosts", async () => {
    const adapter = new TuiRuntimeAdapter({} as never);
    await expect(
      adapter.executeResearchCampaignCommand({
        action: "list",
        sessionId: "root",
      }),
    ).rejects.toThrow("Security campaigns are unavailable");
  });
});
