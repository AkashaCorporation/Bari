import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export interface VerifiedResearchArtifact {
  reference: string;
  sha256: string;
  bytes: number;
}

export interface VerifiedResearchJson extends VerifiedResearchArtifact {
  value: unknown;
}

/** Resolves one regular file inside the campaign's frozen local roots and hashes the opened bytes. */
export async function verifyLocalResearchArtifact(
  localRoots: readonly string[],
  reference: string,
): Promise<VerifiedResearchArtifact> {
  return hashStableFile(await resolveLocalResearchFile(localRoots, reference));
}

async function resolveLocalResearchFile(
  localRoots: readonly string[],
  reference: string,
): Promise<string> {
  if (localRoots.length === 0) {
    throw new Error(
      "Material local evidence requires at least one frozen local root",
    );
  }
  const roots = await Promise.all(
    localRoots.map(async (root) => ({
      declared: root,
      canonical: await realpath(root),
    })),
  );
  const candidates = isAbsolute(reference)
    ? [reference]
    : roots.map((root) => resolve(root.canonical, reference));
  const matches = new Map<string, string>();

  for (const candidate of candidates) {
    let canonical: string;
    try {
      canonical = await realpath(candidate);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) continue;
      throw error;
    }
    if (!roots.some((root) => isInsideOrEqual(canonical, root.canonical))) {
      if (isAbsolute(reference)) {
        throw new Error(
          "Material evidence path escapes the frozen local roots",
        );
      }
      continue;
    }
    const info = await lstat(canonical);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("Material evidence is not a safe regular file");
    }
    matches.set(canonical.toLocaleLowerCase("en-US"), canonical);
  }

  if (matches.size === 0)
    throw new Error("Material evidence file was not found in frozen roots");
  if (matches.size > 1) {
    throw new Error(
      "Relative material evidence reference is ambiguous across frozen roots",
    );
  }
  return [...matches.values()][0]!;
}

export async function readVerifiedResearchJson(
  localRoots: readonly string[],
  reference: string,
  maxBytes = 16 * 1024 * 1024,
): Promise<VerifiedResearchJson> {
  const path = await resolveLocalResearchFile(localRoots, reference);
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Research JSON is not a regular file");
    if (before.size > maxBytes) throw new Error("Research JSON exceeds the size limit");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    assertStableRead(before, after, bytes.byteLength);
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch (error) {
      throw new Error("Research JSON is invalid", { cause: error });
    }
    return {
      reference: path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
      value,
    };
  } finally {
    await handle.close();
  }
}

async function hashStableFile(path: string): Promise<VerifiedResearchArtifact> {
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile())
      throw new Error("Material evidence is not a regular file");
    const hash = createHash("sha256");
    let bytes = 0;
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      bytes += buffer.byteLength;
    }
    const after = await handle.stat();
    assertStableRead(before, after, bytes);
    return { reference: path, sha256: hash.digest("hex"), bytes };
  } finally {
    await handle.close();
  }
}

function assertStableRead(
  before: { size: number; mtimeMs: number; ino: number },
  after: { size: number; mtimeMs: number; ino: number },
  bytes: number,
): void {
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino ||
    bytes !== after.size
  ) {
    throw new Error("Material evidence changed while Runtime was reading it");
  }
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot))
  );
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}
