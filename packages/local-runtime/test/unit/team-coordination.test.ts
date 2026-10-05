import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { routeLocalTeamApi } from "../../src/team/api.js";
import type { LocalSessionRecord } from "../../src/sessions/controller.js";

const cleanup: string[] = [];
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

function session(sessionId: string, agentName: string): LocalSessionRecord {
  return {
    sessionId,
    agentName,
    workspaceDir: "C:/workspace",
    runtime: {},
    sessionType: "root",
    archived: false,
  } as unknown as LocalSessionRecord;
}

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "bari-team-coordination-"));
  cleanup.push(dataDir);
  const sessions = new Map([
    ["ses_owner", session("ses_owner", "mavis")],
    ["ses_worker", session("ses_worker", "june")],
    ["ses_verifier", session("ses_verifier", "vera")],
    // Never joins, so it exercises the non-member paths.
    ["ses_outsider", session("ses_outsider", "stranger")],
  ]);
  const call = (parts: string[], method: string, body?: unknown, query = "") =>
    routeLocalTeamApi({
      dataDir,
      request: new Request(`http://local/${parts.join("/")}${query}`, {
        method,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      }),
      method,
      parts,
      url: new URL(`http://local/${parts.join("/")}${query}`),
      nowMs: () => 1_800_000_000_000,
      getSessionById: async (id) => sessions.get(id),
      isTeamDelegationEnabled: async () => true,
    });
  const created = await call(["team", "plan"], "POST", {
    session_id: "ses_owner",
    plan: { tasks: [] },
  });
  const planId = (await created.json()).plan_id as string;
  const recordPath = join(dataDir, "plans", planId, "plan.json");
  const addMember = async (from: string, role?: string) => {
    const response = await call(["team", "plan", planId, "members"], "POST", {
      from_session: from,
      ...(role ? { role } : {}),
    });
    return (await response.json()) as { member?: { member_id: string } };
  };
  return { dataDir, call, planId, recordPath, addMember };
}

describe("team roster", () => {
  it("lets a session join and returns the new roster", async () => {
    const { call, planId } = await fixture();
    const response = await call(["team", "plan", planId, "members"], "POST", {
      from_session: "ses_worker",
      role: "verifier",
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.member).toMatchObject({
      agent_name: "june",
      session_id: "ses_worker",
      role: "verifier",
      joined_at: 1_800_000_000_000,
    });
    expect(body.member.member_id).toMatch(/^tm_[0-9a-f]{16}$/u);
    expect(body.members).toHaveLength(1);
  });

  it("keeps the roster across a separate call, because it is written to the plan", async () => {
    const { call, planId, addMember } = await fixture();
    await addMember("ses_worker");
    const roster = await call(["team", "plan", planId, "members"], "GET");
    expect(roster.status).toBe(200);
    expect((await roster.json()).members).toHaveLength(1);
  });

  it("refuses a second join by the same session", async () => {
    const { call, planId, addMember } = await fixture();
    await addMember("ses_worker");
    const again = await call(["team", "plan", planId, "members"], "POST", {
      from_session: "ses_worker",
    });
    expect(again.status).toBe(409);
  });

  it("refuses a session that does not exist", async () => {
    const { call, planId } = await fixture();
    const response = await call(["team", "plan", planId, "members"], "POST", {
      from_session: "ses_ghost",
    });
    expect(response.status).toBe(404);
  });

  it("refuses a role a session may not claim by joining", async () => {
    const { call, planId } = await fixture();
    // `owner` is set at plan creation; a second owner would make every
    // owner-only operation ambiguous.
    const response = await call(["team", "plan", planId, "members"], "POST", {
      from_session: "ses_worker",
      role: "owner",
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Unsupported member role/);
  });

  it("refuses a join without a session", async () => {
    const { call, planId } = await fixture();
    expect((await call(["team", "plan", planId, "members"], "POST", {})).status).toBe(400);
  });

  it("takes the agent name from the session, not from the caller", async () => {
    const { call, planId } = await fixture();
    const response = await call(["team", "plan", planId, "members"], "POST", {
      from_session: "ses_worker",
      agent_name: "someone-else",
    });
    expect((await response.json()).member.agent_name).toBe("june");
  });

  it("reads an absent roster as empty rather than undefined", async () => {
    const { call, planId, recordPath } = await fixture();
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    delete record.state.members;
    await writeFile(recordPath, JSON.stringify(record), "utf8");
    expect(await (await call(["team", "plan", planId, "members"], "GET")).json()).toMatchObject({
      members: [],
    });
  });
});

describe("team mailbox", () => {
  it("carries a message from one member to another", async () => {
    const { call, planId, addMember } = await fixture();
    const worker = await addMember("ses_worker");
    const verifier = await addMember("ses_verifier", "verifier");

    const response = await call(["team", "plan", planId, "messages"], "POST", {
      from_session: "ses_worker",
      to: verifier.member!.member_id,
      body: "verify the parser change",
    });
    expect(response.status).toBe(201);
    const { message } = await response.json();
    expect(message).toMatchObject({
      from_session_id: "ses_worker",
      to_session_id: "ses_verifier",
      to_member_id: verifier.member!.member_id,
      body: "verify the parser change",
      read_at: null,
    });
    expect(message.message_id).toMatch(/^msg_[0-9a-f]{16}$/u);
  });

  it("remembers the message across a separate call", async () => {
    const { call, planId, addMember } = await fixture();
    const worker = await addMember("ses_worker");
    await addMember("ses_verifier");
    await call(["team", "plan", planId, "messages"], "POST", {
      from_session: "ses_worker",
      to: worker.member!.member_id,
      body: "still here?",
    });
    const listed = await call(["team", "plan", planId, "messages"], "GET");
    expect((await listed.json()).messages).toHaveLength(1);
  });

  it("refuses a sender who never joined", async () => {
    const { call, planId, addMember } = await fixture();
    const worker = await addMember("ses_worker");
    const response = await call(["team", "plan", planId, "messages"], "POST", {
      from_session: "ses_outsider",
      to: worker.member!.member_id,
      body: "hello",
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/not a team member/);
  });

  it("refuses a recipient who never joined, rather than storing it for nobody", async () => {
    const { call, planId, addMember } = await fixture();
    await addMember("ses_worker");
    const response = await call(["team", "plan", planId, "messages"], "POST", {
      from_session: "ses_worker",
      to: "ses_outsider",
      body: "hello",
    });
    expect(response.status).toBe(404);
  });

  it("requires a body and bounds its size", async () => {
    const { call, planId, addMember } = await fixture();
    await addMember("ses_worker");
    await addMember("ses_verifier");

    const empty = await call(["team", "plan", planId, "messages"], "POST", {
      from_session: "ses_worker",
      to: "ses_verifier",
      body: "",
    });
    expect(empty.status).toBe(400);

    const oversized = await call(["team", "plan", planId, "messages"], "POST", {
      from_session: "ses_worker",
      to: "ses_verifier",
      body: "x".repeat(4097),
    });
    expect(oversized.status).toBe(413);
  });

  it("filters the mailbox by recipient", async () => {
    const { call, planId, addMember } = await fixture();
    await addMember("ses_worker");
    await addMember("ses_verifier");
    const shared = await call(["team", "plan", planId, "messages"], "POST", {
      from_session: "ses_worker",
      to: "ses_verifier",
      body: "for the verifier",
    });
    expect(shared.status).toBe(201);

    const forVerifier = await call(
      ["team", "plan", planId, "messages"],
      "GET",
      undefined,
      "?to_session=ses_verifier",
    );
    expect((await forVerifier.json()).messages).toHaveLength(1);
    const forOwner = await call(
      ["team", "plan", planId, "messages"],
      "GET",
      undefined,
      "?to_session=ses_owner",
    );
    expect((await forOwner.json()).messages).toEqual([]);
  });

  it("lets only the addressed session acknowledge, and does it once", async () => {
    const { call, planId, addMember } = await fixture();
    await addMember("ses_worker");
    await addMember("ses_verifier");
    const sent = await call(["team", "plan", planId, "messages"], "POST", {
      from_session: "ses_worker",
      to: "ses_verifier",
      body: "please confirm",
    });
    const messageId = (await sent.json()).message.message_id as string;

    const wrongReader = await call(
      ["team", "plan", planId, "messages", messageId, "ack"],
      "POST",
      { from_session: "ses_worker" },
    );
    expect(wrongReader.status).toBe(403);

    const ack = await call(
      ["team", "plan", planId, "messages", messageId, "ack"],
      "POST",
      { from_session: "ses_verifier" },
    );
    expect(ack.status).toBe(200);
    expect((await ack.json()).message.read_at).toBe(1_800_000_000_000);

    const again = await call(
      ["team", "plan", planId, "messages", messageId, "ack"],
      "POST",
      { from_session: "ses_verifier" },
    );
    expect(await again.json()).toMatchObject({ alreadyRead: true });
  });

  it("refuses an unknown message id without touching the plan", async () => {
    const { call, planId, addMember } = await fixture();
    await addMember("ses_verifier");
    const response = await call(
      ["team", "plan", planId, "messages", "msg_0000000000000000", "ack"],
      "POST",
      { from_session: "ses_verifier" },
    );
    expect(response.status).toBe(404);
  });

  it("refuses to grow past the mailbox bound instead of dropping the oldest", async () => {
    const { call, planId, addMember, recordPath } = await fixture();
    await addMember("ses_worker");
    await addMember("ses_verifier");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    record.state.messages = Array.from({ length: 500 }, (_value, index) => ({
      message_id: `msg_${index.toString(16).padStart(16, "0")}`,
      from_session_id: "ses_worker",
      to_session_id: "ses_verifier",
      to_member_id: record.state.members[1].member_id,
      body: "filler",
      sent_at: 1_800_000_000_000,
      read_at: null,
    }));
    await writeFile(recordPath, JSON.stringify(record), "utf8");

    const response = await call(["team", "plan", planId, "messages"], "POST", {
      from_session: "ses_worker",
      to: "ses_verifier",
      body: "one too many",
    });
    expect(response.status).toBe(507);
    expect((await response.json()).error).toMatch(/Mailbox is full/);
  });

  it("reads an absent mailbox as empty rather than undefined", async () => {
    const { call, planId, recordPath } = await fixture();
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    delete record.state.messages;
    await writeFile(recordPath, JSON.stringify(record), "utf8");
    expect(
      await (await call(["team", "plan", planId, "messages"], "GET")).json(),
    ).toMatchObject({ messages: [] });
  });
});