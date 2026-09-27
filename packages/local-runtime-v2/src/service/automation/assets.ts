import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  learningSkillRootForIdentity,
  withManagedAssetLock,
} from "@bari/shared/automation-assets";
import { assetHash, type LearningAsset } from "./proposals.js";
import type { AutomationStore, LearningRun } from "./store.js";

/** Logical targets resolve inside managed profile resources, never model-supplied paths. */
export class LearningAssets {
  constructor(
    private readonly dataDir: string,
    private readonly store: AutomationStore,
  ) {}

  path(run: LearningRun, kind: string, target: string): string {
    if (
      !run.agentName ||
      /[\\/:\0]/.test(run.agentName) ||
      [".", ".."].includes(run.agentName)
    )
      throw new Error("Invalid memory owner");
    let path: string;
    if (kind === "memory" && target === "main")
      path = join(this.dataDir, "agents", run.agentName, "memory", "MEMORY.md");
    else if (
      kind === "memory" &&
      /^topic:[a-z0-9][a-z0-9_-]{0,63}$/.test(target)
    )
      path = join(
        this.dataDir,
        "agents",
        run.agentName,
        "memory",
        "topics",
        `${target.slice(6)}.md`,
      );
    else if (
      kind === "skill" &&
      /^learned-[a-z0-9][a-z0-9-]{1,47}$/.test(target)
    )
      path = join(
        learningSkillRootForIdentity(
          this.dataDir,
          run.agentName,
          run.workspaceKey,
        ),
        target,
        "SKILL.md",
      );
    else throw new Error("Unsupported managed asset");
    this.assertPath(path);
    return path;
  }
  snapshot(run: LearningRun): LearningAsset[] {
    const assets: LearningAsset[] = [];
    const add = (kind: "memory" | "skill", target: string) => {
      const text = this.read(this.path(run, kind, target));
      assets.push({ kind, target, text, hash: assetHash(text) });
    };
    add("memory", "main");
    const topics = join(
      this.dataDir,
      "agents",
      run.agentName,
      "memory",
      "topics",
    );
    if (existsSync(topics)) {
      this.assertPath(topics);
      for (const name of readdirSync(topics)
        .filter((name) => /^[a-z0-9][a-z0-9_-]{0,63}\.md$/.test(name))
        .slice(0, 16))
        add("memory", `topic:${name.slice(0, -3)}`);
    }
    const skills = learningSkillRootForIdentity(
      this.dataDir,
      run.agentName,
      run.workspaceKey,
    );
    if (existsSync(skills)) {
      this.assertPath(skills);
      for (const name of readdirSync(skills)
        .filter((name) => /^learned-[a-z0-9][a-z0-9-]{1,47}$/.test(name))
        .slice(0, 64))
        add("skill", name);
    }
    return assets;
  }
  async apply(
    run: LearningRun,
    change: {
      before: LearningAsset;
      after: string;
      proposal: { evidence: unknown };
    },
    allowed: () => boolean,
  ): Promise<void> {
    const target = this.path(run, change.before.kind, change.before.target);
    await withManagedAssetLock(target, () => {
      this.assertPath(target);
      if (
        !allowed() ||
        !this.store.valid(run) ||
        assetHash(this.read(target)) !== change.before.hash
      )
        throw new Error("Learning apply conflict");
      const id = this.store.intent({
        runId: run.runId,
        kind: change.before.kind,
        target: change.before.target,
        beforeHash: change.before.hash,
        afterHash: assetHash(change.after),
        beforeText: change.before.text,
        afterText: change.after,
        evidenceJson: JSON.stringify(change.proposal.evidence),
      });
      this.write(target, change.after);
      this.store.changeState(id, "applied");
    });
  }
  async rollback(
    runId: string,
  ): Promise<{ restored: number; conflicts: number; expired: number }> {
    const run = this.store.get(runId);
    if (!run || ["pending", "running"].includes(run.state))
      throw new Error("Learning run is not settled");
    let restored = 0,
      conflicts = 0,
      expired = 0;
    for (const change of this.store.journal(runId).reverse()) {
      if (change.state === "expired") {
        expired++;
        continue;
      }
      if (
        !["applied", "intent", "rollback_intent", "rollback_conflict"].includes(
          change.state,
        )
      )
        continue;
      const target = this.path(run, change.kind, change.target);
      await withManagedAssetLock(target, () => {
        this.assertPath(target);
        const current = assetHash(this.read(target));
        if (
          change.state === "rollback_intent" &&
          current === change.beforeHash
        ) {
          this.store.changeState(change.changeId, "rolled_back");
          restored++;
          return;
        }
        if (current !== change.afterHash) {
          conflicts++;
          this.store.changeState(change.changeId, "rollback_conflict");
          return;
        }
        this.store.changeState(change.changeId, "rollback_intent");
        this.write(target, change.beforeText);
        this.store.changeState(change.changeId, "rolled_back");
        restored++;
      });
    }
    this.store.finish(
      runId,
      conflicts
        ? "rollback_conflict"
        : expired
          ? "rollback_expired"
          : "rolled_back",
      undefined,
      { restored, conflicts, expired },
    );
    return { restored, conflicts, expired };
  }
  recoverIntents(): void {
    for (const change of this.store.interruptedIntents()) {
      const run = this.store.get(change.runId);
      if (!run || this.store.valid(run)) continue;
      try {
        const current = assetHash(
          this.read(this.path(run, change.kind, change.target)),
        );
        this.store.changeState(
          change.changeId,
          change.state === "rollback_intent"
            ? current === change.beforeHash
              ? "rolled_back"
              : current === change.afterHash
                ? "applied"
                : "conflict"
            : current === change.afterHash
              ? "applied"
              : current === change.beforeHash
                ? "not_applied"
                : "conflict",
        );
      } catch {
        this.store.changeState(change.changeId, "conflict");
      }
    }
  }
  private read(path: string): string | null {
    if (!existsSync(path)) return null;
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 32 * 1024)
      throw new Error("Managed asset cannot be safely read");
    const bytes = readFileSync(path),
      text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes))
      throw new Error("Managed asset is not UTF-8");
    return text;
  }
  private write(path: string, text: string | null): void {
    if (text === null) {
      if (existsSync(path)) unlinkSync(path);
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    this.assertPath(path);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
      renameSync(temporary, path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  private assertPath(path: string): void {
    const root = resolve(this.dataDir),
      absolute = resolve(path),
      rel = relative(root, absolute);
    if (
      !rel ||
      rel.startsWith(`..${sep}`) ||
      rel === ".." ||
      resolve(root, rel) !== absolute
    )
      throw new Error("Managed asset escapes profile");
    let current = root;
    for (const part of rel.split(sep)) {
      current = join(current, part);
      try {
        if (lstatSync(current).isSymbolicLink())
          throw new Error("Managed asset link is not writable");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (
      existsSync(dirname(absolute)) &&
      !realpathSync(dirname(absolute)).startsWith(realpathSync(root) + sep)
    )
      throw new Error("Managed asset parent escapes profile");
  }
}
