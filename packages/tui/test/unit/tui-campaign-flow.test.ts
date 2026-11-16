import { describe, expect, it, vi } from "vitest";

import type { TuiSession } from "../../src/runtime/port.js";
import { createTuiCommandCatalog } from "../../src/tui/commands/catalog.js";
import { TuiCommandFlow } from "../../src/tui/controller/product/command-flow.js";
import { TuiCampaignFlow } from "../../src/tui/controller/product/campaign-flow.js";
import type { TuiResearchCampaignPanel } from "../../src/tui/security-campaign/panel.js";

function harness() {
  let session: TuiSession | undefined = { sessionId: "root" };
  let panel: TuiResearchCampaignPanel | undefined;
  const executeResearchCampaignCommand = vi.fn(async () => ({
    message: "No active campaign",
    campaigns: [],
  }));
  const append = vi.fn();
  const close = vi.fn(() => true);
  const pushFeature = vi.fn(({ screen }) => {
    panel = screen;
    return { id: screen.id, close, isActive: () => true };
  });
  const flow = new TuiCampaignFlow({
    runtime: { executeResearchCampaignCommand },
    currentSession: () => session,
    surfaceHost: { pushFeature },
    append,
    requestRender: vi.fn(),
  });
  return {
    flow,
    executeResearchCampaignCommand,
    append,
    pushFeature,
    panel: () => panel,
    session: (value: TuiSession | undefined) => {
      session = value;
    },
  };
}

function commandFlow(showCampaign?: () => Promise<void>) {
  const append = vi.fn();
  const submit = vi.fn();
  const flow = new TuiCommandFlow({
    workspaceDir: "/workspace",
    controller: {
      snapshot: () => ({
        status: "idle",
        sessions: [],
        session: { sessionId: "root" },
      }),
      submit,
    } as never,
    featureFlow: {
      skillCommands: () => [],
      waitForWelcomeModelSelection: async () => undefined,
      applyPendingModelSelection: async () => undefined,
    } as never,
    activeRunFlow: {} as never,
    feedbackFlow: {} as never,
    sessionMutationFlow: {} as never,
    updateFlow: {} as never,
    sessionFlow: {} as never,
    queueFlow: {} as never,
    interactionFlow: {
      handleCommand: async () => false,
      hasPending: () => false,
    } as never,
    composerDraft: { hasContent: () => false } as never,
    workspaceRoots: { additionalDirectories: () => [] } as never,
    runProjection: { snapshot: () => ({ queuedCount: 0 }) } as never,
    editor: {} as never,
    surface: {} as never,
    surfaceHost: {} as never,
    showCampaign,
    queueEnabled: true,
    liveRunId: () => undefined,
    runtimeStopping: () => false,
    abortLiveTurn: async () => false,
    leaveUi: async () => undefined,
    whenReady: async () => undefined,
    append,
    setHint: vi.fn(),
    onChanged: vi.fn(),
  });
  return { flow, append, submit };
}

describe("security campaign product command and flow", () => {
  it("exposes /campaign aliases through the real catalog", () => {
    const catalog = createTuiCommandCatalog([], { campaign: vi.fn() }, () => ({
      hasSession: true,
      hasParentSession: false,
      managedTokenPresent: false,
      queueEnabled: true,
      hasLiveRun: false,
      queuedCount: 0,
      canRetry: false,
      sideMode: false,
    }));
    expect(
      catalog.slashCommands.some((command) => command.name === "campaign"),
    ).toBe(true);
    expect(catalog.resolve("/research")?.name).toBe("campaign");
  });

  it.each(["/campaign", "/campaigns", "/research"])(
    "dispatches %s locally without submitting a model turn",
    async (input) => {
      const h = harness();
      const commands = commandFlow(() => h.flow.show());
      await expect(commands.flow.submit(input)).resolves.toBe("consumed");
      expect(h.executeResearchCampaignCommand).toHaveBeenCalledWith({
        action: "status",
        sessionId: "root",
      });
      expect(h.pushFeature).toHaveBeenCalledOnce();
      expect(commands.submit).not.toHaveBeenCalled();
    },
  );

  it("reports missing hosts and backend failures without mounting fake success", async () => {
    const commands = commandFlow();
    await commands.flow.submit("/campaign");
    expect(commands.append).toHaveBeenCalledWith(
      "Security campaigns are unavailable in this host.",
      "error",
    );

    const h = harness();
    h.executeResearchCampaignCommand.mockRejectedValueOnce(
      new Error("Store denied"),
    );
    await h.flow.show();
    expect(h.pushFeature).not.toHaveBeenCalled();
    expect(h.append).toHaveBeenCalledWith(
      "Security campaigns: Store denied",
      "error",
    );
  });

  it("pins the panel to the session that opened it", async () => {
    const h = harness();
    await h.flow.show();
    h.session({ sessionId: "different" });
    h.panel()!.handleInput("\r");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.panel()!.render(100).join("\n")).toContain(
      "selected session changed",
    );
    expect(h.executeResearchCampaignCommand).toHaveBeenCalledTimes(1);
  });
});
