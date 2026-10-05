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
  const dataDir = await mkdtemp(join(tmpdir(), "bari-team-roster-"));
  cleanup.push(dataDir);
  const sessions = new Map([
    ["ses_owner", session("ses_owner", "mavis")],
    ["ses_worker", session("ses_worker", "june")],
  ]);
  const call = (parts: string[], method: string, body?: unknown) =>
    routeLocalTeamApi({
      dataDir,
      request: new Request(`http://local/${parts.join("/")}`, {
        method,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      }),
      method,
      parts,
      url: new URL(`http://local/${parts.join("/")}`),
      nowMs: () => 1_800_000_000_000,
      getSessionById: async (id) => sessions.get(id),
      isTeamDelegationEnabled: async () => true,
    });
  const created = await call(["team", "plan"], "POST", {
    session_id: "ses_owner",
    plan: { tasks: [] },
  });
  const planId = (await created.json()).plan_id as string;
  return { dataDir, call, planId };
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
    const { call, planId } = await fixture();
    await call(["team", "plan", planId, "members"], "POST", { from_session: "ses_worker" });
    const roster = await call(["team", "plan", planId, "members"], "GET");
    expect(roster.status).toBe(200);
    expect((await roster.json()).members).toHaveLength(1);
  });

  it("refuses a second join by the same session", async () => {
    const { call, planId } = await fixture();
    await call(["team", "plan", planId, "members"], "POST", { from_session: "ses_worker" });
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
    const response = await call(["team", "plan", planId, "members"], "POST", {});
    expect(response.status).toBe(400);
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
    const { dataDir, call, planId } = await fixture();
    // Rewrite the record the way a plan written before the roster existed looks.
    const recordPath = join(dataDir, "plans", planId, "plan.json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    delete record.state.members;
    await writeFile(recordPath, JSON.stringify(record), "utf8");

    const roster = await call(["team", "plan", planId, "members"], "GET");
    expect(await roster.json()).toMatchObject({ members: [] });
  });
});