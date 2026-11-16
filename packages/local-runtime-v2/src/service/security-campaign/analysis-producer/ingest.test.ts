import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ingestHexCoreAnalysisRun } from "./hexcore.js";
import { ingestHypotenuseAnalysisRun } from "./hypotenuse.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

interface RunOptions {
  runStatus?: "ok" | "partial" | "error" | "running";
  manifestStatus?: "ok" | "partial" | "error";
  stepStatus?: "ok" | "partial" | "error" | "skipped";
  declaredRootSha?: string;
  declaredOutputSha?: string;
  inputOutsideRoot?: boolean;
  javaOutput?: boolean;
}

async function fixture(options: RunOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "bari-analysis-receipt-"));
  temporaryDirectories.push(directory);
  const outside = await mkdtemp(join(tmpdir(), "bari-analysis-outside-"));
  temporaryDirectories.push(outside);

  const rootPath = join(directory, "target.apk");
  const inputPath = options.inputOutsideRoot
    ? join(outside, "classes.dex")
    : join(directory, "classes.dex");
  const outputPath = join(
    directory,
    options.javaOutput ? "Recovered.java" : "analysis.json",
  );
  const jobPath = join(directory, "analysis.hexcore_job.json");
  const provenancePath = join(directory, "analysis.provenance.json");
  const statusPath = join(directory, "analysis.status.json");

  await writeFile(rootPath, "root apk bytes");
  await writeFile(inputPath, "derived dex bytes");
  await writeFile(outputPath, options.javaOutput ? "class Recovered {}" : "{}");
  await writeFile(jobPath, JSON.stringify({ file: rootPath, steps: [] }));

  const rootSha = await digest(rootPath);
  const inputSha = await digest(inputPath);
  const outputSha = await digest(outputPath);
  const jobSha = await digest(jobPath);
  const analysisTarget = {
    contractVersion: 1,
    id: `analysis-target:sha256:${options.declaredRootSha ?? rootSha}`,
    binarySha256: options.declaredRootSha ?? rootSha,
    filePath: rootPath,
    fileSize: Buffer.byteLength("root apk bytes"),
    format: "unknown",
  };
  const analysisSession = {
    contractVersion: 1,
    id: "session-1",
    targetId: analysisTarget.id,
    generation: 2,
    createdAt: "2026-10-22T00:00:00.000Z",
    engines: [
      {
        id: "hexcore-disassembler",
        version: "1.4.70",
        buildSha256: "1".repeat(64),
      },
    ],
  };
  const execution = {
    analysisContractVersion: 1,
    executionId: "execution-1",
    jobFileSha256: jobSha,
    sessionId: "session-1",
    contextGeneration: 2,
    binaryPath: rootPath,
    binarySha256: options.declaredRootSha ?? rootSha,
    analysisTarget,
    analysisSession,
  };
  const stepStatus = options.stepStatus ?? "ok";
  await writeFile(
    provenancePath,
    JSON.stringify({
      schemaVersion: 1,
      status: options.manifestStatus ?? "ok",
      execution,
      artifacts: [
        {
          step: {
            stepIndex: 0,
            stepId: "decompile",
            resolvedCmd: options.javaOutput ? "jadx" : "analyzeAll",
            semanticStatus: stepStatus,
            configurationSha256: "2".repeat(64),
          },
          ownerExtensions: [
            {
              id: options.javaOutput ? "hypotenuse-jadx" : "hexcore-disassembler",
              version: options.javaOutput ? "0.2.0" : "1.4.70",
            },
          ],
          runtimeIdentity: options.javaOutput
            ? {
                engineName: "jadx",
                engineVersion: "1.5.6",
                engineSha256: "3".repeat(64),
              }
            : undefined,
          analysisContract: {
            contractVersion: 1,
            generatedAt: "2026-10-22T00:00:01.000Z",
            target: analysisTarget,
            session: analysisSession,
            producer: [
              {
                id: options.javaOutput ? "hypotenuse-jadx" : "hexcore-disassembler",
                version: options.javaOutput ? "0.2.0" : "1.4.70",
              },
            ],
            status: stepStatus,
            artifact: {
              path: outputPath,
              sha256: options.declaredOutputSha ?? outputSha,
              mediaType: options.javaOutput
                ? "text/x-java-source"
                : "application/json",
            },
            inputs: [
              {
                path: inputPath,
                sha256: inputSha,
                mediaType: "application/vnd.android.dex",
              },
            ],
          },
        },
      ],
    }),
  );
  await writeFile(
    statusPath,
    JSON.stringify({
      status: options.runStatus ?? "ok",
      file: rootPath,
      jobFile: jobPath,
      jobFileSha256: jobSha,
      provenanceManifestPath: provenancePath,
      provenance: execution,
      steps: [{ status: stepStatus }],
      summary: {
        discoveredFunctions: 12,
        materializedFunctions: stepStatus === "ok" ? 12 : 8,
        unsupportedCount: stepStatus === "ok" ? 0 : 4,
      },
    }),
  );
  return { directory, rootSha, inputSha, outputSha, statusPath };
}

describe("analysis producer receipt ingestion", () => {
  it("rehashes HexCore root, effective input, outputs and control artifacts", async () => {
    const f = await fixture();
    const receipt = await ingestHexCoreAnalysisRun({
      localRoots: [f.directory],
      statusPath: f.statusPath,
    });

    expect(receipt.producer).toMatchObject({
      kind: "hexcore-job",
      contract: "analysis-jobs-v1",
      experimental: false,
    });
    expect(receipt.status).toBe("ok");
    expect(receipt.coverage).toMatchObject({ complete: true, totalSteps: 1, okSteps: 1 });
    expect(receipt.rootTarget.sha256).toBe(f.rootSha);
    expect(receipt.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "effective-input", sha256: f.inputSha }),
        expect.objectContaining({ role: "output", sha256: f.outputSha }),
        expect.objectContaining({ role: "job", verification: "runtime-verified" }),
        expect.objectContaining({ role: "status", verification: "runtime-verified" }),
        expect.objectContaining({ role: "provenance", verification: "runtime-verified" }),
      ]),
    );
    expect(receipt.derivations[0]).toMatchObject({
      command: "analyzeAll",
      status: "ok",
      configurationSha256: "2".repeat(64),
    });
    expect(receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects a non-terminal run and mismatched root or output bytes", async () => {
    const running = await fixture({ runStatus: "running" });
    await expect(
      ingestHexCoreAnalysisRun({
        localRoots: [running.directory],
        statusPath: running.statusPath,
      }),
    ).rejects.toThrow("not terminal");

    const wrongRoot = await fixture({ declaredRootSha: "a".repeat(64) });
    await expect(
      ingestHexCoreAnalysisRun({
        localRoots: [wrongRoot.directory],
        statusPath: wrongRoot.statusPath,
      }),
    ).rejects.toThrow("root target hash");

    const wrongOutput = await fixture({ declaredOutputSha: "b".repeat(64) });
    await expect(
      ingestHexCoreAnalysisRun({
        localRoots: [wrongOutput.directory],
        statusPath: wrongOutput.statusPath,
      }),
    ).rejects.toThrow("output 0 hash");
  });

  it("never reports partial coverage as an ok receipt", async () => {
    const partial = await fixture({
      runStatus: "partial",
      manifestStatus: "partial",
      stepStatus: "partial",
    });
    const receipt = await ingestHexCoreAnalysisRun({
      localRoots: [partial.directory],
      statusPath: partial.statusPath,
    });
    expect(receipt.status).toBe("partial");
    expect(receipt.coverage.complete).toBe(false);
    expect(receipt.coverage.partialReasons).toContain("step 0 status partial");
  });

  it("preserves a derived input identity outside the frozen roots as declared partial evidence", async () => {
    const f = await fixture({ inputOutsideRoot: true });
    const receipt = await ingestHexCoreAnalysisRun({
      localRoots: [f.directory],
      statusPath: f.statusPath,
    });
    const effective = receipt.artifacts.find(
      (artifact) => artifact.role === "effective-input",
    );
    expect(receipt.rootTarget.sha256).not.toBe(effective?.sha256);
    expect(effective).toMatchObject({
      sha256: f.inputSha,
      verification: "declared",
    });
    expect(receipt.status).toBe("partial");
    expect(receipt.coverage.complete).toBe(false);
  });

  it("marks the Hypotenuse Jobs adapter experimental and retains JADX runtime identity", async () => {
    const f = await fixture({ javaOutput: true });
    const receipt = await ingestHypotenuseAnalysisRun({
      localRoots: [f.directory],
      statusPath: f.statusPath,
    });
    expect(receipt.producer).toMatchObject({
      kind: "hypotenuse-job",
      experimental: true,
    });
    expect(receipt.producer.identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "jadx", version: "1.5.6" }),
      ]),
    );
    expect(receipt.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "output", mediaType: "text/x-java-source" }),
      ]),
    );
  });
});

async function digest(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
