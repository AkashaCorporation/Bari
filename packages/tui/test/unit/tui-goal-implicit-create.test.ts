import { describe, expect, it, vi } from "vitest";
import { TuiGoalFlow } from "../../src/tui/controller/product/goal-flow.js";

function harness(goal?: { goalId: string; status: string }) {
  const runtime = {
    isGoalEnabled: vi.fn().mockReturnValue(true),
    getGoal: vi.fn().mockResolvedValue(goal),
    createGoal: vi.fn().mockResolvedValue({ goalId: "g-new", status: "active" }),
    patchGoal: vi.fn(),
    clearGoal: vi.fn(),
  };
  const composerDraft = {
    capture: () => ({ attachments: [] }),
    reserveSubmission: vi.fn((captured: unknown) => captured),
    completeSubmission: vi.fn().mockResolvedValue(undefined),
    restoreSubmission: vi.fn(),
    hasContent: () => false,
  };
  const append = vi.fn();
  const setHint = vi.fn();
  const flow = new TuiGoalFlow({
    runtime: runtime as never,
    currentSessionId: () => "s1",
    banner: { setGoal: vi.fn(), getGoal: vi.fn() } as never,
    composerDraft: composerDraft as never,
    editor: { setText: vi.fn() } as never,
    surfaceHost: { setChatFocus: vi.fn() } as never,
    append,
    setHint,
    onChanged: vi.fn(),
  });
  return { flow, runtime, append, setHint };
}

describe("TuiGoalFlow.implicitCreate", () => {
  it("creates a Goal from a natural-language kickoff message", async () => {
    const { flow, runtime, setHint } = harness();
    const disposition = await flow.implicitCreate("vamos subir isso com goal");
    expect(disposition).toBe("consumed");
    expect(runtime.createGoal).toHaveBeenCalledWith({
      sessionId: "s1",
      objective: "vamos subir isso",
    });
    expect(setHint).toHaveBeenCalledWith("Goal started.");
  });

  it("never rewrites an active Goal; the message stays normal work", async () => {
    const { flow, runtime } = harness({ goalId: "g1", status: "active" });
    const disposition = await flow.implicitCreate("fazer no goal");
    expect(disposition).toBe("retained");
    expect(runtime.createGoal).not.toHaveBeenCalled();
    expect(runtime.patchGoal).not.toHaveBeenCalled();
  });

  it("starts a fresh Goal when the previous one is complete", async () => {
    const { flow, runtime } = harness({ goalId: "g1", status: "complete" });
    const disposition = await flow.implicitCreate("com goal: implementar o parser novo");
    expect(disposition).toBe("consumed");
    expect(runtime.createGoal).toHaveBeenCalledWith({
      sessionId: "s1",
      objective: "implementar o parser novo",
    });
  });

  it("leaves ordinary messages untouched", async () => {
    const { flow, runtime } = harness();
    const disposition = await flow.implicitCreate("ajuste o parser de datas");
    expect(disposition).toBe("retained");
    expect(runtime.createGoal).not.toHaveBeenCalled();
  });

  it("stays quiet when the Goal feature is disabled", async () => {
    const { flow, runtime } = harness();
    runtime.isGoalEnabled.mockReturnValue(false);
    const disposition = await flow.implicitCreate("fazer no goal");
    expect(disposition).toBe("retained");
    expect(runtime.createGoal).not.toHaveBeenCalled();
  });
});
