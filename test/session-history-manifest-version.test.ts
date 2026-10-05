import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ensureResolvedSessionHistoryPaths,
  resolveSessionHistoryPaths,
} from "../packages/local-runtime-v2/src/service/session-system/messages/history/session-history-paths.js";
import type { SessionRecord } from "../packages/local-runtime-v2/src/service/session-system/sessions/repo/contract.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SESSION = {
  sessionId: "ses_manifest_version",
  createdAtMs: 1_800_000_000_000,
  updatedAtMs: 1_800_000_000_000,
} as unknown as SessionRecord;

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "bari-history-manifest-"));
  cleanup.push(dataDir);
  const paths = resolveSessionHistoryPaths(dataDir, SESSION);
  mkdirSync(paths.sessionDir, { recursive: true });
  return { dataDir, paths };
}

function writeManifest(paths: { manifest: string }, value: unknown) {
  writeFileSync(paths.manifest, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function identity(extra: Record<string, unknown>) {
  return {
    sessionId: SESSION.sessionId,
    createdAtMs: SESSION.createdAtMs,
    ...extra,
  };
}

describe("session history manifest version", () => {
  it("writes the version and layout it accepts", () => {
    const { paths } = fixture();
    ensureResolvedSessionHistoryPaths(paths, SESSION);
    const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.layout).toBe("v2-final-dated-session");
  });

  it("refuses a manifest from a future schema version", () => {
    const { paths } = fixture();
    // Identity matches, so only the declared version can refuse it. Without the
    // check this directory would be read with this build's fixed file names.
    writeManifest(
      paths,
      identity({ schemaVersion: 2, layout: "v3-something-else", paths: {} }),
    );
    expect(() => ensureResolvedSessionHistoryPaths(paths, SESSION)).toThrow(
      /Unsupported Session history manifest schemaVersion 2/,
    );
  });

  it("refuses an unknown layout even at a known version", () => {
    const { paths } = fixture();
    writeManifest(paths, identity({ schemaVersion: 1, layout: "v9-unknown-layout" }));
    expect(() => ensureResolvedSessionHistoryPaths(paths, SESSION)).toThrow(
      /Unsupported Session history manifest layout v9-unknown-layout/,
    );
  });

  it("still tolerates a manifest that declares neither", () => {
    const { paths } = fixture();
    writeManifest(paths, identity({}));
    expect(() => ensureResolvedSessionHistoryPaths(paths, SESSION)).not.toThrow();
  });

  it("still refuses a mismatched identity", () => {
    const { paths } = fixture();
    writeManifest(paths, { ...identity({ schemaVersion: 1 }), sessionId: "ses_someone_else" });
    expect(() => ensureResolvedSessionHistoryPaths(paths, SESSION)).toThrow(
      /identity mismatch/,
    );
  });
});
