import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  readVerifiedResearchJson,
  verifyLocalResearchArtifact,
} from "./local-artifact.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function root(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("local research artifact verification", () => {
  it("resolves a relative regular file inside a frozen root and hashes the opened bytes", async () => {
    const directory = await root("bari-research-artifact-");
    await mkdir(join(directory, "evidence"));
    const bytes = Buffer.from("bounded evidence\n", "utf8");
    await writeFile(join(directory, "evidence", "proof.txt"), bytes);
    const verified = await verifyLocalResearchArtifact(
      [directory],
      "evidence/proof.txt",
    );
    expect(verified).toEqual({
      reference: resolve(directory, "evidence", "proof.txt"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    });
  });

  it("rejects absolute paths outside every frozen root", async () => {
    const allowed = await root("bari-research-allowed-");
    const outside = await root("bari-research-outside-");
    const path = join(outside, "proof.txt");
    await writeFile(path, "outside");
    await expect(verifyLocalResearchArtifact([allowed], path)).rejects.toThrow(
      "escapes the frozen local roots",
    );
  });

  it("rejects ambiguous relative references across multiple roots", async () => {
    const first = await root("bari-research-first-");
    const second = await root("bari-research-second-");
    await writeFile(join(first, "proof.txt"), "first");
    await writeFile(join(second, "proof.txt"), "second");
    await expect(
      verifyLocalResearchArtifact([first, second], "proof.txt"),
    ).rejects.toThrow("ambiguous");
  });

  it("rejects directories and missing local roots instead of recording unverified bytes", async () => {
    const directory = await root("bari-research-directory-");
    await mkdir(join(directory, "not-a-file"));
    await expect(
      verifyLocalResearchArtifact([directory], "not-a-file"),
    ).rejects.toThrow("regular file");
    await expect(verifyLocalResearchArtifact([], "proof.txt")).rejects.toThrow(
      "frozen local root",
    );
  });

  it("parses only bounded JSON whose exact bytes were hashed", async () => {
    const directory = await root("bari-research-json-");
    const path = join(directory, "status.json");
    const bytes = Buffer.from('{"status":"ok","count":2}\n', "utf8");
    await writeFile(path, bytes);
    await expect(readVerifiedResearchJson([directory], path)).resolves.toEqual({
      reference: resolve(path),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      value: { status: "ok", count: 2 },
    });
    await expect(readVerifiedResearchJson([directory], path, 4)).rejects.toThrow(
      "size limit",
    );
  });
});
