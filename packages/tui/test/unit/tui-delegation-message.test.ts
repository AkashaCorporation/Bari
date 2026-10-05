import { describe, expect, it, vi } from "vitest";

import { TuiDelegationAccess } from "../../src/runtime/adapters/delegation-access.js";
import { toTuiDelegatedAgent } from "../../src/runtime/delegation.js";
import type { TuiSession } from "../../src/runtime/port.js";

function delegatedSession(
  sessionId: string,
  parentSessionId: string,
  agentName: string,
  title?: string,
): TuiSession {
  return {
    sessionId,
    parentSessionId,
    agentName,
    sessionType: "branch",
    sessionKind: "task",
    status: "running",
    ...(title ? { title } : {}),
  } as unknown as TuiSession;
}

function access(overrides: { sessions?: TuiSession[]; enqueue?: (input: unknown) => Promise<boolean> } = {}) {
  const enqueueMessage = vi.fn(overrides.enqueue ?? (async () => true));
  const instance = new TuiDelegationAccess({
    listSessionPage: async () => ({
      sessions: overrides.sessions ?? [delegatedSession("ses_worker", "ses_root", "worker")],
      hasMore: false,
    }),
    abortSession: async () => true,
    enqueueMessage,
  } as never);
  return { instance, enqueueMessage };
}

describe("delegated agent role", () => {
  it("marks a builtin verifier as the checker and everything else as a worker", () => {
    const verifier = toTuiDelegatedAgent(
      delegatedSession("ses_v", "ses_root", "verifier") as never,
    );
    expect(verifier.role).toBe("verifier");
    for (const agentName of ["worker", "explore", "mavis", "JUNE"]) {
      const member = toTuiDelegatedAgent(
        delegatedSession("ses_w", "ses_root", agentName) as never,
      );
      expect(member.role).toBe("worker");
    }
  });

  it("derives the role from the session rather than accepting one", () => {
    // A role passed in alongside the session must not win: the team is the set
    // of delegated sessions, so a stored role could disagree with it.
    const member = toTuiDelegatedAgent({
      ...delegatedSession("ses_w", "ses_root", "worker"),
      role: "verifier",
    } as never);
    expect(member.role).toBe("worker");
  });
});

describe("delegation message delivery", () => {
  it("queues the message into a team member's own session", async () => {
    const { instance, enqueueMessage } = access();
    const receipt = await instance.sendMessage({
      rootSessionId: "ses_root",
      sessionId: "ses_worker",
      body: "  check the parser change  ",
      clientRequestId: "req-1",
    });
    expect(receipt).toEqual({ schemaVersion: 1, sessionId: "ses_worker", delivered: true });
    // Trimmed before delivery, and the idempotency key is passed through.
    expect(enqueueMessage).toHaveBeenCalledWith({
      sessionId: "ses_worker",
      content: "check the parser change",
      clientRequestId: "req-1",
    });
  });

  it("refuses a session that is not on this team, without touching the queue", async () => {
    const { instance, enqueueMessage } = access();
    const receipt = await instance.sendMessage({
      rootSessionId: "ses_root",
      sessionId: "ses_stranger",
      body: "hello",
    });
    expect(receipt).toMatchObject({ delivered: false, reason: "not_a_team_member" });
    expect(enqueueMessage).not.toHaveBeenCalled();
  });

  it("bounds the body before it reaches the queue", async () => {
    const { instance, enqueueMessage } = access();
    expect(
      await instance.sendMessage({ rootSessionId: "ses_root", sessionId: "ses_worker", body: "   " }),
    ).toMatchObject({ delivered: false, reason: "empty_body" });
    expect(
      await instance.sendMessage({
        rootSessionId: "ses_root",
        sessionId: "ses_worker",
        body: "x".repeat(4097),
      }),
    ).toMatchObject({ delivered: false, reason: "body_too_long" });
    expect(enqueueMessage).not.toHaveBeenCalled();
  });

  it("reports a queue refusal instead of a silent success", async () => {
    const { instance } = access({ enqueue: async () => false });
    expect(
      await instance.sendMessage({ rootSessionId: "ses_root", sessionId: "ses_worker", body: "hi" }),
    ).toMatchObject({ delivered: false, reason: "delivery_failed" });
  });

  it("reports delivery_failed when the runtime has no queue to write to", async () => {
    const instance = new TuiDelegationAccess({
      listSessionPage: async () => ({
        sessions: [delegatedSession("ses_worker", "ses_root", "worker")],
        hasMore: false,
      }),
      abortSession: async () => true,
    } as never);
    expect(
      await instance.sendMessage({ rootSessionId: "ses_root", sessionId: "ses_worker", body: "hi" }),
    ).toMatchObject({ delivered: false, reason: "delivery_failed" });
  });
});
