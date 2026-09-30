import { describe, expect, it, vi } from "vitest";
import {
  RuntimeEventStatus,
  RuntimeEventType,
  type RuntimeEvent,
} from "@bari/agent-core/protocol";

import { LearningLifecycleObserver } from "../packages/local-runtime-v2/src/service/automation/lifecycle-observer.js";
import { createLearningPorts } from "../packages/local-runtime-v2/src/service/automation/adapter.js";
import type { LearningRun } from "../packages/local-runtime-v2/src/service/automation/store.js";

const run = {
  runId: "run-1",
  parentSessionId: "parent-1",
  agentName: "mavis",
  workspaceDir: "C:/work",
} as unknown as LearningRun;

function event(type: RuntimeEventType, status: RuntimeEventStatus): RuntimeEvent {
  return { type, payload: { status } } as unknown as RuntimeEvent;
}

const terminal = event(RuntimeEventType.TURN_TERMINAL, RuntimeEventStatus.COMPLETED);
const running = event(RuntimeEventType.SESSION_STATUS, RuntimeEventStatus.RUNNING);

describe("LearningLifecycleObserver", () => {
  it("admits a settled turn that carried a genuine user prompt", async () => {
    const onTurnCompleted = vi.fn();
    const observer = new LearningLifecycleObserver({
      onUserActivity: vi.fn(),
      onTurnCompleted,
      readTurnUserPrompt: vi.fn().mockResolvedValue("please fix the parser"),
    });
    observer.observe({
      context: { sessionId: "s1", turnId: "t1" },
      event: terminal,
    });
    await vi.waitFor(() =>
      expect(onTurnCompleted).toHaveBeenCalledWith("s1", "t1", "please fix the parser"),
    );
  });

  it("never admits a turn without a user prompt", async () => {
    const onTurnCompleted = vi.fn();
    const observer = new LearningLifecycleObserver({
      onUserActivity: vi.fn(),
      onTurnCompleted,
      readTurnUserPrompt: vi.fn().mockResolvedValue(undefined),
    });
    observer.observe({
      context: { sessionId: "s1", turnId: "t1" },
      event: terminal,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(onTurnCompleted).not.toHaveBeenCalled();
  });

  it("treats a starting turn as user work", () => {
    const onUserActivity = vi.fn();
    const observer = new LearningLifecycleObserver({
      onUserActivity,
      onTurnCompleted: vi.fn(),
      readTurnUserPrompt: vi.fn(),
    });
    observer.observe({
      context: { sessionId: "s1", turnId: "t1" },
      event: running,
    });
    expect(onUserActivity).toHaveBeenCalledWith("s1");
  });

  it.each(["learning", "cron", "background-task"])(
    "ignores host-owned %s turns entirely",
    (source) => {
      const onUserActivity = vi.fn();
      const onTurnCompleted = vi.fn();
      const observer = new LearningLifecycleObserver({
        onUserActivity,
        onTurnCompleted,
        readTurnUserPrompt: vi.fn(),
      });
      observer.observe({
        context: { sessionId: "s1", turnId: "t1", provenance: { source } },
        event: running,
      });
      observer.observe({
        context: { sessionId: "s1", turnId: "t1", provenance: { source } },
        event: terminal,
      });
      expect(onUserActivity).not.toHaveBeenCalled();
      expect(onTurnCompleted).not.toHaveBeenCalled();
    },
  );

  it("swallows capture failures instead of failing the turn", async () => {
    const onTurnCompleted = vi.fn();
    const observer = new LearningLifecycleObserver({
      onUserActivity: vi.fn(),
      onTurnCompleted,
      readTurnUserPrompt: vi.fn().mockRejectedValue(new Error("db gone")),
    });
    observer.observe({
      context: { sessionId: "s1", turnId: "t1" },
      event: terminal,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(onTurnCompleted).not.toHaveBeenCalled();
  });
});

describe("createLearningPorts", () => {
  it("captures evidence, assets and assistant message count", async () => {
    const host = {
      getSession: vi.fn().mockResolvedValue({ agentName: "mavis", workspaceDir: "C:/work" }),
      isBusy: vi.fn().mockResolvedValue(false),
      readEvidence: vi
        .fn()
        .mockResolvedValue([
          { messageId: "m1", role: "user", text: "fix the parser" },
          { messageId: "m2", role: "assistant", text: "fixed" },
        ]),
      resolveModelProvider: vi.fn().mockResolvedValue("opencode-go"),
      createChildSession: vi.fn(),
      deliverTurn: vi.fn(),
      waitForTurn: vi.fn(),
      readAssistantText: vi.fn(),
      readTurnUserPrompt: vi.fn(),
    };
    const ports = createLearningPorts({
      host,
      assetsSnapshot: () => [
        { kind: "skill", target: "learned-fixtures", text: "x", hash: "h" },
      ],
    });
    const context = await ports.capture(run, {} as never);
    expect(context.assistantMessages).toBe(1);
    expect(context.evidence).toHaveLength(2);
    expect(context.existingSkillNames).toEqual(["learned-fixtures"]);
    expect(context.modelProvider).toBe("opencode-go");
  });

  it("runs one child turn and returns the reply", async () => {
    const onChild = vi.fn();
    const host = {
      getSession: vi.fn().mockResolvedValue({ agentName: "mavis", workspaceDir: "C:/work" }),
      isBusy: vi.fn().mockResolvedValue(false),
      readEvidence: vi.fn().mockResolvedValue([]),
      resolveModelProvider: vi.fn().mockResolvedValue("opencode-go"),
      createChildSession: vi.fn().mockResolvedValue("child-1"),
      deliverTurn: vi.fn().mockResolvedValue({ turnId: "turn-1" }),
      waitForTurn: vi.fn().mockResolvedValue(undefined),
      readAssistantText: vi.fn().mockResolvedValue('{"changes":[]}'),
      readTurnUserPrompt: vi.fn(),
    };
    const ports = createLearningPorts({ host, assetsSnapshot: () => [] });
    const text = await ports.execute(run, {} as never, {
      text: "envelope",
      schema: {} as never,
      signal: new AbortController().signal,
      deadline: Date.now() + 1000,
      onChild,
    });
    expect(text).toBe('{"changes":[]}');
    expect(onChild).toHaveBeenCalledWith("child-1", "turn-1");
    expect(host.deliverTurn).toHaveBeenCalledWith({
      sessionId: "child-1",
      runId: "run-1",
      text: "envelope",
    });
  });

  it("fails when the child turn is not admitted", async () => {
    const host = {
      getSession: vi.fn().mockResolvedValue({ agentName: "mavis", workspaceDir: "C:/work" }),
      isBusy: vi.fn().mockResolvedValue(false),
      readEvidence: vi.fn().mockResolvedValue([]),
      resolveModelProvider: vi.fn().mockResolvedValue("opencode-go"),
      createChildSession: vi.fn().mockResolvedValue("child-1"),
      deliverTurn: vi.fn().mockResolvedValue(undefined),
      waitForTurn: vi.fn(),
      readAssistantText: vi.fn(),
      readTurnUserPrompt: vi.fn(),
    };
    const ports = createLearningPorts({ host, assetsSnapshot: () => [] });
    await expect(
      ports.execute(run, {} as never, {
        text: "envelope",
        schema: {} as never,
        signal: new AbortController().signal,
        deadline: Date.now() + 1000,
        onChild: vi.fn(),
      }),
    ).rejects.toThrow("learning_turn_not_admitted");
  });

  it("fails when the child turn committed no assistant reply", async () => {
    const host = {
      getSession: vi.fn().mockResolvedValue({ agentName: "mavis", workspaceDir: "C:/work" }),
      isBusy: vi.fn().mockResolvedValue(false),
      readEvidence: vi.fn().mockResolvedValue([]),
      resolveModelProvider: vi.fn().mockResolvedValue("opencode-go"),
      createChildSession: vi.fn().mockResolvedValue("child-1"),
      deliverTurn: vi.fn().mockResolvedValue({ turnId: "turn-1" }),
      waitForTurn: vi.fn().mockResolvedValue(undefined),
      readAssistantText: vi.fn().mockResolvedValue(undefined),
      readTurnUserPrompt: vi.fn(),
    };
    const ports = createLearningPorts({ host, assetsSnapshot: () => [] });
    await expect(
      ports.execute(run, {} as never, {
        text: "envelope",
        schema: {} as never,
        signal: new AbortController().signal,
        deadline: Date.now() + 1000,
        onChild: vi.fn(),
      }),
    ).rejects.toThrow("learning_turn_empty");
  });
});
