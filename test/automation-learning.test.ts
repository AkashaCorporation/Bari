import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  DEFAULT_BARI_AUTOMATION,
  parseBariAutomationConfig,
} from "@bari/config";
import {
  learningWorkspaceKey,
  withManagedAssetLock,
} from "@bari/shared/automation-assets";
import { DatabaseClient } from "../packages/local-runtime-v2/src/infra/db/client.js";
import { runMigrations } from "../packages/local-runtime-v2/src/infra/db/migrate.js";
import { ALL_MIGRATIONS } from "../packages/local-runtime-v2/src/infra/db/migrations.js";
import { assertDatabaseSchemaConsistent } from "../packages/local-runtime-v2/src/infra/db/schema-consistency.js";
import { automationChanges } from "../packages/local-runtime-v2/src/infra/db/schema/automation.js";
import { AutomationStore } from "../packages/local-runtime-v2/src/service/automation/store.js";
import { LearningAssets } from "../packages/local-runtime-v2/src/service/automation/assets.js";
import {
  AutomationCoordinator,
  type AutomationPorts,
} from "../packages/local-runtime-v2/src/service/automation/coordinator.js";
import {
  assetHash,
  validateLearningProposals,
  type LearningProposal,
} from "../packages/local-runtime-v2/src/service/automation/proposals.js";
import { LocalMemoryFacade } from "../packages/local-runtime/src/memory/local-memory-facade.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const evidence = [1, 2].map((n) => ({
  id: `e${n}`,
  messageId: `message-${n}`,
  role: "user",
  text: `Use reproducible synthetic fixtures for workflow ${n}.`,
  hash: assetHash(`source-${n}`),
}));
const memory: LearningProposal = {
  kind: "memory",
  target: "main",
  operation: "append",
  text: "Use reproducible synthetic fixtures.",
  evidence: [{ id: "e1", quote: evidence[0]!.text }],
};
const skill: LearningProposal = {
  kind: "skill",
  target: "learned-fixtures",
  operation: "write",
  text: "---\nname: learned-fixtures\ndescription: Build reproducible synthetic fixtures\n---\nUse temporary synthetic inputs and verify the expected outputs.\n",
  evidence: evidence.map((e) => ({ id: e.id, quote: e.text })),
};
function validate(
  proposal: LearningProposal,
  assets: Parameters<typeof validateLearningProposals>[1]["assets"] = [],
) {
  return validateLearningProposals(
    { changes: [proposal] },
    { evidence, assets, dream: true, distill: true, existingSkillNames: [] },
  );
}
function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "bari-automation-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const client = new DatabaseClient({ dataDir });
  cleanup.push(() => client.close());
  runMigrations(client.rawDb, ALL_MIGRATIONS);
  let now = 1_800_000_000_000;
  const store = new AutomationStore(client.db, () => now);
  const assets = new LearningAssets(dataDir, store);
  const config = {
    ...DEFAULT_BARI_AUTOMATION,
    minAssistantMessages: 2,
    idleDelayMs: 1000,
  };
  const enqueue = (parentSessionId = "parent", sourceTurnId = "turn") =>
    store.enqueue({
      parentSessionId,
      sourceTurnId,
      agentName: "mavis",
      workspaceDir: dataDir,
      workspaceKey: learningWorkspaceKey(dataDir),
      groupKey: `${dataDir}:mavis`,
    });
  return {
    dataDir,
    client,
    store,
    assets,
    config,
    enqueue,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("automatic learning admission and journal", () => {
  it("migrates both the upstream schema and Bari extensions consistently", () => {
    const f = fixture();
    expect(() => assertDatabaseSchemaConsistent(f.client.rawDb)).not.toThrow();
    expect(() => runMigrations(f.client.rawDb, ALL_MIGRATIONS)).not.toThrow();
  });
  it("deduplicates a completed turn and fences a claim after new user activity", () => {
    const f = fixture(),
      run = f.enqueue();
    expect(f.enqueue().runId).toBe(run.runId);
    expect(f.store.claim(run, f.config)).toBe(true);
    expect(f.store.valid(run)).toBe(true);
    f.store.userActivity("parent");
    expect(f.store.valid(run)).toBe(false);
    expect(f.store.claim(run, f.config)).toBe(false);
  });
  it("shares the single running lease across database connections", () => {
    const f = fixture();
    const other = new DatabaseClient({ dataDir: f.dataDir });
    cleanup.push(() => other.close());
    const peer = new AutomationStore(other.db, f.now);
    const first = f.enqueue(),
      second = f.enqueue("other");
    expect(f.store.claim(first, f.config)).toBe(true);
    expect(peer.claim(second, f.config)).toBe(false);
    f.advance(f.config.timeoutMs + 10001);
    expect(peer.claim(second, { ...f.config, cooldownMs: 0 })).toBe(true);
    expect(f.store.get(first.runId)?.state).toBe("interrupted");
    expect(f.store.valid(first)).toBe(false);
  });
  it("charges failed calls to the daily cap and cooldown", () => {
    const f = fixture(),
      first = f.enqueue();
    expect(f.store.claim(first, f.config)).toBe(true);
    f.store.finish(first.runId, "failed");
    const second = f.enqueue("other");
    expect(f.store.claim(second, f.config)).toBe(false);
    expect(f.store.get(second.runId)?.reason).toBe("cooldown");
    const third = f.enqueue("third");
    expect(f.store.claim(third, { ...f.config, maxRunsPerDay: 1 })).toBe(false);
    expect(f.store.get(third.runId)?.reason).toBe("daily_budget");
  });
  it("supersedes obsolete pending work and bounds the global queue", () => {
    const f = fixture(),
      first = f.enqueue();
    f.enqueue("parent", "new-turn");
    expect(f.store.get(first.runId)?.reason).toBe("superseded");
    for (let n = 0; n < 20; n++) f.enqueue(`parent-${n}`);
    expect(f.store.pending()).toHaveLength(16);
    expect(
      f.store.list(100).filter((row) => row.reason === "queue_full"),
    ).toHaveLength(5);
  });
  it("applies a journaled change, refuses stale content, and rolls back exactly once", async () => {
    const f = fixture(),
      run = f.enqueue();
    f.store.claim(run, f.config);
    const change = validate(memory)[0]!;
    await f.assets.apply(run, change, () => true);
    const path = f.assets.path(run, "memory", "main");
    expect(readFileSync(path, "utf8")).toBe(memory.text);
    expect(f.store.journal(run.runId)[0]?.state).toBe("applied");
    await expect(f.assets.apply(run, change, () => true)).rejects.toThrow(
      "conflict",
    );
    f.store.finish(run.runId, "applied");
    expect(await f.assets.rollback(run.runId)).toEqual({
      restored: 1,
      conflicts: 0,
      expired: 0,
    });
    expect(existsSync(path)).toBe(false);
    expect((await f.assets.rollback(run.runId)).restored).toBe(0);
  });
  it("preserves a later user edit during rollback", async () => {
    const f = fixture(),
      run = f.enqueue();
    f.store.claim(run, f.config);
    await f.assets.apply(run, validate(memory)[0]!, () => true);
    const path = f.assets.path(run, "memory", "main");
    writeFileSync(path, "User edit");
    f.store.finish(run.runId, "applied");
    expect((await f.assets.rollback(run.runId)).conflicts).toBe(1);
    expect(readFileSync(path, "utf8")).toBe("User edit");
  });
  it("recovers interrupted writes and interrupted rollback without guessing", async () => {
    const f = fixture(),
      run = f.enqueue();
    f.store.claim(run, f.config);
    await f.assets.apply(run, validate(memory)[0]!, () => true);
    const change = f.store.journal(run.runId)[0]!;
    f.store.changeState(change.changeId, "intent");
    f.store.finish(run.runId, "interrupted");
    f.assets.recoverIntents();
    expect(f.store.journal(run.runId)[0]?.state).toBe("applied");
    f.store.changeState(change.changeId, "rollback_intent");
    rmSync(f.assets.path(run, "memory", "main"));
    f.assets.recoverIntents();
    expect(f.store.journal(run.runId)[0]?.state).toBe("rolled_back");
  });
  it("reports expired rollback images rather than claiming restoration", async () => {
    const f = fixture(),
      run = f.enqueue();
    f.store.claim(run, f.config);
    await f.assets.apply(run, validate(memory)[0]!, () => true);
    f.store.finish(run.runId, "applied");
    f.client.db
      .update(automationChanges)
      .set({ state: "expired", beforeText: null, afterText: null })
      .where(eq(automationChanges.runId, run.runId))
      .run();
    expect((await f.assets.rollback(run.runId)).expired).toBe(1);
    expect(f.store.get(run.runId)?.state).toBe("rollback_expired");
  });
  it("rechecks policy and the generation after acquiring the file lock", async () => {
    const f = fixture(),
      run = f.enqueue();
    f.store.claim(run, f.config);
    await expect(
      f.assets.apply(run, validate(memory)[0]!, () => false),
    ).rejects.toThrow("conflict");
    expect(f.store.journal(run.runId)).toEqual([]);
    f.store.userActivity("parent");
    await expect(
      f.assets.apply(run, validate(memory)[0]!, () => true),
    ).rejects.toThrow("conflict");
  });
  it("rejects directory junctions leading outside the profile", () => {
    const f = fixture(),
      run = f.enqueue();
    const outside = mkdtempSync(join(tmpdir(), "bari-outside-"));
    cleanup.push(() => rmSync(outside, { recursive: true, force: true }));
    mkdirSync(join(f.dataDir, "agents"), { recursive: true });
    symlinkSync(
      outside,
      join(f.dataDir, "agents", "mavis"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => f.assets.path(run, "memory", "main")).toThrow("link");
    expect(existsSync(join(outside, "memory"))).toBe(false);
  });
  it("serializes ordinary memory append with managed writes", async () => {
    const f = fixture(),
      run = f.enqueue();
    const facade = new LocalMemoryFacade({
      config: () => ({ dataDir: f.dataDir, enabled: true }),
      nowMs: f.now,
    });
    const path = f.assets.path(run, "memory", "main");
    await facade.writeMemory("mavis", "Initial");
    let release!: () => void, locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const held = withManagedAssetLock(path, async () => {
      locked();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      writeFileSync(path, "Managed");
    });
    await acquired;
    const append = facade.appendMemory("mavis", "User");
    release();
    await held;
    await append;
    expect(readFileSync(path, "utf8")).toBe("Managed\nUser");
  });
  it("does not create memory folders while memory is disabled", async () => {
    const f = fixture();
    const facade = new LocalMemoryFacade({
      config: () => ({ dataDir: f.dataDir, enabled: false }),
      nowMs: f.now,
    });
    await expect(facade.appendMemory("mavis", "User")).rejects.toThrow();
    expect(existsSync(join(f.dataDir, "agents"))).toBe(false);
  });
});

describe("learning proposal validation", () => {
  it("requires independent source messages for distilled workflows", () => {
    expect(validate(skill)).toHaveLength(1);
    expect(() =>
      validate({
        ...skill,
        evidence: [skill.evidence[0]!, skill.evidence[0]!],
      }),
    ).toThrow("independent");
    expect(() =>
      validateLearningProposals(
        { changes: [skill] },
        {
          evidence: evidence.map((e) => ({ ...e, messageId: "same-message" })),
          assets: [],
          dream: true,
          distill: true,
          existingSkillNames: [],
        },
      ),
    ).toThrow("independent");
  });
  it.each(["../outside", "topic:../../file", "C:\\file", "topic:Name"])(
    "rejects memory target %s",
    (target) => {
      expect(() => validate({ ...memory, target })).toThrow("target");
    },
  );
  it("rejects invented quotations, assistant-only claims, and extra controls", () => {
    expect(() =>
      validate({
        ...memory,
        evidence: [{ id: "e1", quote: "This quotation is invented." }],
      }),
    ).toThrow("evidence");
    expect(() =>
      validateLearningProposals(
        { changes: [memory] },
        {
          evidence: evidence.map((e) => ({ ...e, role: "assistant" })),
          assets: [],
          dream: true,
          distill: true,
          existingSkillNames: [],
        },
      ),
    ).toThrow("evidence");
    expect(() =>
      validate({ ...memory, shell: "anything" } as LearningProposal),
    ).toThrow("fields");
    expect(() =>
      validate({
        ...skill,
        text: skill.text.replace(
          "\n---\nUse",
          "\nallowed-tools: Bash\n---\nUse",
        ),
      }),
    ).toThrow("frontmatter");
  });
  it("refuses credentials and writes to an existing manual skill", () => {
    expect(() =>
      validate({ ...memory, text: "password=synthetic-only-secret-value" }),
    ).toThrow("Sensitive");
    expect(() =>
      validateLearningProposals(
        { changes: [skill] },
        {
          evidence,
          assets: [],
          dream: true,
          distill: true,
          existingSkillNames: [skill.target],
        },
      ),
    ).toThrow("owns");
  });
  it("applies literal edits and rejects ambiguous matches", () => {
    const assets = [
      {
        kind: "memory" as const,
        target: "main",
        text: "Old fact",
        hash: assetHash("Old fact"),
      },
    ];
    expect(
      validate(
        { ...memory, operation: "edit", oldText: "Old", text: "$&" },
        assets,
      )[0]?.after,
    ).toBe("$& fact");
    expect(() =>
      validate({ ...memory, operation: "edit", oldText: "missing" }, assets),
    ).toThrow("exactly once");
  });
  it("defaults on with bounded costs and treats malformed switches as off", () => {
    expect(parseBariAutomationConfig(undefined)).toEqual(
      DEFAULT_BARI_AUTOMATION,
    );
    expect(parseBariAutomationConfig({ enabled: "true" }).enabled).toBe(false);
    expect(parseBariAutomationConfig(null).enabled).toBe(false);
    expect(parseBariAutomationConfig({ maxRunsPerDay: 0 }).maxRunsPerDay).toBe(
      0,
    );
    expect(
      parseBariAutomationConfig({ maxOutputTokens: 999999 }).maxOutputTokens,
    ).toBe(8192);
  });
});

describe("idle learning lifecycle", () => {
  function setup() {
    const f = fixture();
    const coordinator = new AutomationCoordinator(
      f.store,
      f.assets,
      () => f.config,
      f.now,
    );
    cleanup.push(() => coordinator.close());
    const ports: AutomationPorts = {
      describe: async () => ({
        agentName: "mavis",
        workspaceDir: f.dataDir,
        eligible: true,
      }),
      busy: async () => false,
      capture: async (run) => ({
        evidence,
        assets: f.assets.snapshot(run),
        existingSkillNames: [],
        assistantMessages: 2,
        systemPrompt: "Synthetic evaluation",
        modelProvider: "synthetic",
      }),
      execute: vi.fn(async () => JSON.stringify({ changes: [memory] })),
    };
    coordinator.bind(ports);
    return { ...f, coordinator, ports };
  }
  it("runs only after the idle boundary and applies one validated proposal", async () => {
    const f = setup(),
      run = f.enqueue();
    await f.coordinator.tick();
    expect(f.ports.execute).not.toHaveBeenCalled();
    f.advance(1000);
    await f.coordinator.tick();
    expect(f.ports.execute).toHaveBeenCalledTimes(1);
    expect(f.store.get(run.runId)?.state).toBe("applied");
    await f.assets.rollback(run.runId);
    expect(JSON.parse(f.store.get(run.runId)!.reportJson!).sources).toEqual(
      evidence.map(({ id, messageId, hash }) => ({ id, messageId, hash })),
    );
    await f.coordinator.tick();
    expect(f.ports.execute).toHaveBeenCalledTimes(1);
  });
  it("never overwrites memory after the parent resumes", async () => {
    const f = setup(),
      run = f.enqueue();
    f.ports.execute = async () => {
      f.coordinator.userActivity("parent");
      return JSON.stringify({ changes: [memory] });
    };
    f.advance(1000);
    await f.coordinator.tick();
    expect(f.store.get(run.runId)?.state).toBe("cancelled");
    expect(f.store.journal(run.runId)).toEqual([]);
  });
  it("cancels queued work immediately when disabled", async () => {
    const f = setup(),
      run = f.enqueue();
    f.config.enabled = false;
    await f.coordinator.tick();
    expect(f.store.get(run.runId)?.reason).toBe("disabled");
    expect(f.ports.execute).not.toHaveBeenCalled();
  });
  it("discards asynchronous admission overtaken by new user activity", async () => {
    const f = setup();
    let release!: () => void;
    f.ports.describe = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { agentName: "mavis", workspaceDir: f.dataDir, eligible: true };
    };
    f.coordinator.completed("parent", "old-turn", "A completed task");
    f.coordinator.userActivity("parent");
    release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.store.list()).toEqual([]);
  });
  it("rejects malformed output without applying any file", async () => {
    const f = setup(),
      run = f.enqueue();
    f.ports.execute = async () => "{bad JSON";
    f.advance(1000);
    await f.coordinator.tick();
    expect(f.store.get(run.runId)?.state).toBe("failed");
    expect(f.store.journal(run.runId)).toEqual([]);
  });
  it("records partial application when a later target changes concurrently", async () => {
    const f = setup(),
      run = f.enqueue();
    f.ports.execute = async () => {
      const target = f.assets.path(run, "skill", skill.target);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, "Concurrent user skill");
      return JSON.stringify({ changes: [memory, skill] });
    };
    f.advance(1000);
    await f.coordinator.tick();
    expect(f.store.get(run.runId)?.state).toBe("partially_applied");
    expect(
      JSON.parse(f.store.get(run.runId)!.reportJson!).sources,
    ).toHaveLength(2);
    expect((await f.assets.rollback(run.runId)).restored).toBe(1);
    expect(
      readFileSync(f.assets.path(run, "skill", skill.target), "utf8"),
    ).toBe("Concurrent user skill");
  });
  it("leaves busy parents queued and skips insufficient evidence without a call", async () => {
    const f = setup(),
      run = f.enqueue();
    f.advance(1000);
    f.ports.busy = async () => true;
    await f.coordinator.tick();
    expect(f.store.get(run.runId)?.state).toBe("pending");
    f.ports.busy = async () => false;
    const capture = f.ports.capture;
    f.ports.capture = async (...args) => ({
      ...(await capture(...args)),
      assistantMessages: 0,
    });
    await f.coordinator.tick();
    expect(f.store.get(run.runId)?.reason).toBe("insufficient_evidence");
    expect(f.ports.execute).not.toHaveBeenCalled();
  });
});
