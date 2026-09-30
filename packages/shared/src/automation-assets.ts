import { createHash } from "node:crypto";
import {
  realpathSync,
  mkdirSync,
  openSync,
  writeFileSync,
  closeSync,
  readFileSync,
  unlinkSync,
  lstatSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export function learningWorkspaceKey(workspaceDir: string): string {
  let absolute = resolve(workspaceDir);
  try {
    absolute = realpathSync.native(absolute);
  } catch {
    /* unavailable workspace keeps a stable candidate identity */
  }
  const canonical =
    process.platform === "win32" ? absolute.toLowerCase() : absolute;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

export function learningSkillRoot(
  dataDir: string,
  agentName: string,
  workspaceDir: string,
): string {
  return learningSkillRootForIdentity(
    dataDir,
    agentName,
    learningWorkspaceKey(workspaceDir),
  );
}

export function learningSkillRootForIdentity(
  dataDir: string,
  agentName: string,
  workspaceKey: string,
): string {
  if (!agentName.trim() || !/^[a-f0-9]{24}$/.test(workspaceKey))
    throw new Error("Invalid learning identity");
  const owner = createHash("sha256")
    .update(agentName)
    .digest("hex")
    .slice(0, 24);
  return join(dataDir, "automation", "skills", workspaceKey, owner);
}

/** Cooperative cross-process lock shared by normal memory writes and learning CAS. */
export async function withManagedAssetLock<T>(
  target: string,
  work: () => T | Promise<T>,
): Promise<T> {
  mkdirSync(dirname(target), { recursive: true });
  const lock = `${target}.bari-lock`;
  const nonce = randomUUID();
  const body = JSON.stringify({ pid: process.pid, nonce });
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      try {
        writeFileSync(fd, body);
      } finally {
        closeSync(fd);
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (lstatSync(lock).isSymbolicLink())
          throw new Error("Unsafe asset lock");
        const before = readFileSync(lock, "utf8");
        const owner = JSON.parse(before) as { pid?: number };
        if (Number.isSafeInteger(owner.pid) && owner.pid! > 0) {
          try {
            process.kill(owner.pid!, 0);
          } catch (probe) {
            if (
              (probe as NodeJS.ErrnoException).code === "ESRCH" &&
              readFileSync(lock, "utf8") === before
            ) {
              unlinkSync(lock);
              continue;
            }
          }
        }
      } catch {
        /* Unknown ownership never authorizes deleting a lock. */
      }
      if (Date.now() >= deadline) throw new Error("Managed asset is busy");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await work();
  } finally {
    try {
      if (readFileSync(lock, "utf8") === body) unlinkSync(lock);
    } catch {
      /* preserve a changed lock */
    }
  }
}
