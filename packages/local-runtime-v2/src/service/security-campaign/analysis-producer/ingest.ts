import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  readVerifiedResearchJson,
  verifyLocalResearchArtifact,
  type VerifiedResearchArtifact,
} from "../local-artifact.js";
import type {
  AnalysisArtifactRole,
  AnalysisDerivationEdge,
  AnalysisProducerIdentity,
  AnalysisProducerReceiptDraft,
  AnalysisProducerStatus,
  AnalysisReceiptArtifact,
  IngestAnalysisRunInput,
} from "./contracts.js";
import { createAnalysisReceiptDigest } from "./digest.js";

const SHA256 = /^[a-f0-9]{64}$/iu;
const TERMINAL_RUN_STATUSES = new Set(["ok", "partial", "error"]);
const TERMINAL_MANIFEST_STATUSES = new Set(["ok", "partial", "error"]);

export async function ingestAnalysisProducerRun(
  input: IngestAnalysisRunInput,
): Promise<AnalysisProducerReceiptDraft> {
  const warnings: string[] = [];
  const statusFile = await readVerifiedResearchJson(input.localRoots, input.statusPath);
  const status = requireRecord(statusFile.value, "analysis status");
  const rawStatus = requireString(status.status, "analysis status.status");
  if (!TERMINAL_RUN_STATUSES.has(rawStatus)) {
    throw new Error(`Analysis run is not terminal: ${rawStatus}`);
  }

  const provenanceReference = requireString(
    status.provenanceManifestPath,
    "analysis status.provenanceManifestPath",
  );
  const provenanceFile = await readVerifiedResearchJson(
    input.localRoots,
    provenanceReference,
    32 * 1024 * 1024,
  );
  const manifest = requireRecord(provenanceFile.value, "analysis provenance");
  if (manifest.schemaVersion !== 1) {
    throw new Error("Unsupported analysis provenance schema");
  }
  const rawManifestStatus = requireString(
    manifest.status,
    "analysis provenance.status",
  );
  if (!TERMINAL_MANIFEST_STATUSES.has(rawManifestStatus)) {
    throw new Error(`Analysis provenance is not terminal: ${rawManifestStatus}`);
  }
  const statusExecution = requireRecord(status.provenance, "analysis status.provenance");
  const manifestExecution = requireRecord(
    manifest.execution,
    "analysis provenance.execution",
  );
  if (
    statusExecution.analysisContractVersion !== 1 ||
    manifestExecution.analysisContractVersion !== 1
  ) {
    throw new Error("Unsupported analysis execution contract");
  }
  const statusExecutionId = optionalString(statusExecution.executionId);
  const manifestExecutionId = optionalString(manifestExecution.executionId);
  if (
    statusExecutionId &&
    manifestExecutionId &&
    statusExecutionId !== manifestExecutionId
  ) {
    throw new Error("Status and provenance describe different analysis executions");
  }

  const rootReference =
    nestedString(statusExecution, ["analysisTarget", "filePath"]) ??
    optionalString(statusExecution.binaryPath) ??
    requireString(status.file, "analysis status.file");
  const declaredRootSha = (
    nestedString(statusExecution, ["analysisTarget", "binarySha256"]) ??
    requireString(statusExecution.binarySha256, "analysis status binarySha256")
  ).toLowerCase();
  requireSha256(declaredRootSha, "analysis target sha256");
  const verifiedRoot = await verifyLocalResearchArtifact(
    input.localRoots,
    rootReference,
  );
  assertDigest(verifiedRoot, declaredRootSha, "analysis root target");
  assertExecutionTargetBinding(
    manifestExecution,
    verifiedRoot.reference,
    declaredRootSha,
    "analysis provenance execution",
  );

  const jobReference = requireString(status.jobFile, "analysis status.jobFile");
  const jobFile = await verifyLocalResearchArtifact(input.localRoots, jobReference);
  const declaredJobSha = optionalString(status.jobFileSha256)?.toLowerCase();
  if (declaredJobSha) {
    requireSha256(declaredJobSha, "analysis job sha256");
    assertDigest(jobFile, declaredJobSha, "analysis job");
  } else {
    warnings.push("status omitted jobFileSha256");
  }
  for (const [label, execution] of [
    ["analysis status execution", statusExecution],
    ["analysis provenance execution", manifestExecution],
  ] as const) {
    const executionJobSha = optionalString(execution.jobFileSha256)?.toLowerCase();
    if (!executionJobSha) continue;
    requireSha256(executionJobSha, `${label} job sha256`);
    assertDigest(jobFile, executionJobSha, `${label} job`);
  }

  const artifacts: AnalysisReceiptArtifact[] = [];
  const artifactKeys = new Set<string>();
  const addArtifact = (artifact: AnalysisReceiptArtifact): AnalysisReceiptArtifact => {
    const key = `${artifact.role}\0${artifact.reference}\0${artifact.sha256}`;
    if (!artifactKeys.has(key)) {
      artifactKeys.add(key);
      artifacts.push(artifact);
    }
    return artifacts.find(
      (entry) =>
        entry.role === artifact.role &&
        entry.reference === artifact.reference &&
        entry.sha256 === artifact.sha256,
    )!;
  };

  const rootTarget = addArtifact(
    verifiedArtifact("root-target", verifiedRoot, mediaTypeFor(rootReference)),
  );
  const statusArtifact = addArtifact(
    verifiedArtifact("status", statusFile, "application/json"),
  );
  const provenanceArtifact = addArtifact(
    verifiedArtifact("provenance", provenanceFile, "application/json"),
  );
  const jobArtifact = addArtifact(
    verifiedArtifact("job", jobFile, "application/json"),
  );

  const identities: AnalysisProducerIdentity[] = [];
  collectIdentities(statusExecution, identities);
  collectIdentities(manifestExecution, identities);
  const derivations: AnalysisDerivationEdge[] = [];
  const manifestEntries = requireArray(manifest.artifacts, "analysis provenance.artifacts");

  for (const [entryIndex, rawEntry] of manifestEntries.entries()) {
    const entry = requireRecord(rawEntry, `analysis provenance artifact ${entryIndex}`);
    const contract = requireRecord(
      entry.analysisContract,
      `analysis provenance artifact ${entryIndex}.analysisContract`,
    );
    if (contract.contractVersion !== 1) {
      throw new Error(`Analysis provenance artifact ${entryIndex} uses an unsupported contract`);
    }
    assertContractTargetBinding(
      contract,
      verifiedRoot.reference,
      declaredRootSha,
      entryIndex,
    );
    const contractArtifact = requireRecord(
      contract.artifact,
      `analysis provenance artifact ${entryIndex}.analysisContract.artifact`,
    );
    const duplicateArtifact = isRecord(entry.artifact) ? entry.artifact : undefined;
    const outputReference =
      optionalString(contractArtifact.path) ??
      optionalString(duplicateArtifact?.path);
    const outputSha = (
      optionalString(contractArtifact.sha256) ??
      optionalString(duplicateArtifact?.sha256) ??
      ""
    ).toLowerCase();
    if (!outputReference || !SHA256.test(outputSha)) {
      throw new Error(`Analysis provenance artifact ${entryIndex} has no valid output identity`);
    }
    const outputFile = await verifyLocalResearchArtifact(
      input.localRoots,
      outputReference,
    );
    assertDigest(outputFile, outputSha, `analysis output ${entryIndex}`);
    const step = requireRecord(entry.step, `analysis provenance artifact ${entryIndex}.step`);
    const command =
      optionalString(step.resolvedCmd) ??
      optionalString(step.cmd) ??
      "unknown";
    const semanticStatus = normalizeStatus(optionalString(step.semanticStatus) ?? contract.status);
    const output = addArtifact(
      verifiedArtifact(
        "output",
        outputFile,
        optionalString(contractArtifact.mediaType) ?? mediaTypeFor(outputReference),
      ),
    );

    const inputArtifacts: AnalysisReceiptArtifact[] = [];
    const rawInputs = Array.isArray(contract.inputs)
      ? contract.inputs
      : Array.isArray(entry.inputs)
        ? entry.inputs
        : [];
    for (const [inputIndex, rawInput] of rawInputs.entries()) {
      const declared = requireRecord(
        rawInput,
        `analysis provenance artifact ${entryIndex}.input ${inputIndex}`,
      );
      const reference = requireString(declared.path, "analysis input.path");
      const digest = requireString(declared.sha256, "analysis input.sha256").toLowerCase();
      requireSha256(digest, "analysis input sha256");
      const verified = await verifyOptionalInput(
        input.localRoots,
        reference,
        digest,
        optionalString(declared.mediaType),
        warnings,
      );
      inputArtifacts.push(addArtifact(verified));
    }

    collectEntryIdentities(entry, identities);
    collectContractIdentities(contract, identities);
    derivations.push({
      outputArtifactId: output.id,
      inputArtifactIds: inputArtifacts.map((artifact) => artifact.id),
      command,
      status: semanticStatus,
      ...(safeInteger(step.stepIndex) !== undefined
        ? { stepIndex: safeInteger(step.stepIndex) }
        : safeInteger(step.index) !== undefined
          ? { stepIndex: Math.max(0, safeInteger(step.index)! - 1) }
          : {}),
      ...(optionalString(step.stepId) ? { stepId: optionalString(step.stepId) } : {}),
      ...(optionalSha256(step.configurationSha256)
        ? { configurationSha256: optionalSha256(step.configurationSha256) }
        : {}),
    });
  }

  const steps = requireArray(status.steps, "analysis status.steps");
  const stepStatuses = steps.map((step, index) =>
    normalizeStatus(requireRecord(step, `analysis step ${index}`).status),
  );
  const runStatus = normalizeStatus(rawStatus);
  const manifestStatus = normalizeStatus(rawManifestStatus);
  const baseReceiptStatus = aggregateStatus([
    runStatus,
    manifestStatus,
    ...stepStatuses,
  ]);
  const producerIdentities = uniqueIdentities(identities);
  if (producerIdentities.length === 0) warnings.push("producer identity unavailable");
  const partialReasons = collectPartialReasons(
    runStatus,
    manifestStatus,
    stepStatuses,
    artifacts,
    warnings,
  );
  const receiptStatus =
    baseReceiptStatus === "ok" && partialReasons.length > 0
      ? "partial"
      : baseReceiptStatus;
  const coverage = coverageFrom(status, stepStatuses, partialReasons);

  const receiptWithoutDigest = {
    schemaVersion: 1 as const,
    producer: {
      kind: input.producer,
      contract: "analysis-jobs-v1" as const,
      experimental: input.producer === "hypotenuse-job",
      identities: producerIdentities,
    },
    status: receiptStatus,
    rootTarget,
    artifacts,
    derivations,
    coverage,
    source: {
      statusArtifactId: statusArtifact.id,
      provenanceArtifactId: provenanceArtifact.id,
      jobArtifactId: jobArtifact.id,
      ...(statusExecutionId ?? manifestExecutionId
        ? { executionId: statusExecutionId ?? manifestExecutionId }
        : {}),
      ...(optionalString(statusExecution.sessionId)
        ? { sessionId: optionalString(statusExecution.sessionId) }
        : {}),
      ...(safeInteger(statusExecution.contextGeneration) !== undefined
        ? { generation: safeInteger(statusExecution.contextGeneration) }
        : {}),
    },
    warnings: [...new Set(warnings)].slice(0, 256),
  };
  return {
    ...receiptWithoutDigest,
    receiptSha256: createAnalysisReceiptDigest(receiptWithoutDigest),
  };
}

function collectPartialReasons(
  runStatus: AnalysisProducerStatus,
  manifestStatus: AnalysisProducerStatus,
  steps: readonly AnalysisProducerStatus[],
  artifacts: readonly AnalysisReceiptArtifact[],
  warnings: readonly string[],
): string[] {
  const reasons: string[] = [];
  if (runStatus !== "ok") reasons.push(`run status ${runStatus}`);
  if (manifestStatus !== "ok") reasons.push(`provenance status ${manifestStatus}`);
  steps.forEach((status, index) => {
    if (status !== "ok") reasons.push(`step ${index} status ${status}`);
  });
  if (artifacts.some((artifact) => artifact.verification !== "runtime-verified")) {
    reasons.push("one or more referenced artifacts were not runtime-verified");
  }
  reasons.push(...warnings);
  return [...new Set(reasons)];
}

function coverageFrom(
  status: Record<string, unknown>,
  stepStatuses: readonly AnalysisProducerStatus[],
  partialReasons: string[],
) {
  const summary = isRecord(status.summary) ? status.summary : {};
  const okSteps = stepStatuses.filter((value) => value === "ok").length;
  const partialSteps = stepStatuses.filter((value) => value === "partial").length;
  const failedSteps = stepStatuses.filter((value) => value === "failed").length;
  const skippedSteps = stepStatuses.filter((value) => value === "skipped").length;
  return {
    complete: partialReasons.length === 0,
    partialReasons,
    totalSteps: stepStatuses.length,
    okSteps,
    partialSteps,
    failedSteps,
    skippedSteps,
    ...(safeInteger(summary.materializedFunctions) !== undefined
      ? { materializedFunctions: safeInteger(summary.materializedFunctions) }
      : {}),
    ...(safeInteger(summary.discoveredFunctions) !== undefined
      ? { discoveredFunctions: safeInteger(summary.discoveredFunctions) }
      : {}),
    ...(safeInteger(summary.unsupportedCount) !== undefined
      ? { unsupportedCount: safeInteger(summary.unsupportedCount) }
      : {}),
  };
}

async function verifyOptionalInput(
  localRoots: readonly string[],
  reference: string,
  declaredSha256: string,
  mediaType: string | undefined,
  warnings: string[],
): Promise<AnalysisReceiptArtifact> {
  try {
    const actual = await verifyLocalResearchArtifact(localRoots, reference);
    assertDigest(actual, declaredSha256, `analysis input ${reference}`);
    return verifiedArtifact(
      "effective-input",
      actual,
      mediaType ?? mediaTypeFor(reference),
    );
  } catch (error) {
    warnings.push(
      `input not runtime-verified: ${reference}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      id: artifactId("effective-input", declaredSha256, reference),
      role: "effective-input",
      reference: resolve(reference),
      sha256: declaredSha256,
      ...(mediaType ? { mediaType } : {}),
      verification: "declared",
    };
  }
}

function verifiedArtifact(
  role: AnalysisArtifactRole,
  artifact: VerifiedResearchArtifact,
  mediaType?: string,
): AnalysisReceiptArtifact {
  return {
    id: artifactId(role, artifact.sha256, artifact.reference),
    role,
    reference: artifact.reference,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    ...(mediaType ? { mediaType } : {}),
    verification: "runtime-verified",
  };
}

function artifactId(role: AnalysisArtifactRole, digest: string, reference: string): string {
  return `analysis:${role}:sha256:${createHash("sha256")
    .update(digest)
    .update("\0")
    .update(resolve(reference))
    .digest("hex")}`;
}

function collectIdentities(
  execution: Record<string, unknown>,
  output: AnalysisProducerIdentity[],
): void {
  const session = isRecord(execution.analysisSession) ? execution.analysisSession : undefined;
  if (!Array.isArray(session?.engines)) return;
  for (const raw of session.engines) {
    const engine = isRecord(raw) ? raw : undefined;
    const id = optionalString(engine?.id);
    const version = optionalString(engine?.version);
    if (!id || !version) continue;
    output.push({
      id,
      version,
      ...(optionalSha256(engine?.buildSha256)
        ? { buildSha256: optionalSha256(engine?.buildSha256) }
        : {}),
    });
  }
}

function collectEntryIdentities(
  entry: Record<string, unknown>,
  output: AnalysisProducerIdentity[],
): void {
  if (Array.isArray(entry.ownerExtensions)) {
    for (const raw of entry.ownerExtensions) {
      const owner = isRecord(raw) ? raw : undefined;
      const id = optionalString(owner?.id);
      const version = optionalString(owner?.version);
      if (id && version) output.push({ id, version });
    }
  }
  if (!isRecord(entry.runtimeIdentity)) return;
  const details: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(entry.runtimeIdentity).slice(0, 32)) {
    if (
      /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key) &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    ) {
      details[key] = typeof value === "string" ? value.slice(0, 2048) : value;
    }
  }
  const id =
    optionalString(details.engineName) ??
    optionalString(details.component) ??
    "runtime-engine";
  const version =
    optionalString(details.engineVersion) ??
    optionalString(details.extensionVersion) ??
    "unknown";
  output.push({
    id,
    version,
    ...(optionalSha256(details.engineSha256)
      ? { buildSha256: optionalSha256(details.engineSha256) }
      : {}),
    details,
  });
}

function collectContractIdentities(
  contract: Record<string, unknown>,
  output: AnalysisProducerIdentity[],
): void {
  if (!Array.isArray(contract.producer)) return;
  for (const raw of contract.producer) {
    const producer = isRecord(raw) ? raw : undefined;
    const id = optionalString(producer?.id);
    const version = optionalString(producer?.version);
    if (!id || !version) continue;
    output.push({
      id,
      version,
      ...(optionalSha256(producer?.buildSha256)
        ? { buildSha256: optionalSha256(producer?.buildSha256) }
        : {}),
    });
  }
}

function assertExecutionTargetBinding(
  execution: Record<string, unknown>,
  rootReference: string,
  rootSha256: string,
  label: string,
): void {
  const target = requireRecord(execution.analysisTarget, `${label}.analysisTarget`);
  const targetPath = requireString(target.filePath, `${label}.analysisTarget.filePath`);
  const targetSha = requireString(
    target.binarySha256,
    `${label}.analysisTarget.binarySha256`,
  ).toLowerCase();
  requireSha256(targetSha, `${label} target sha256`);
  if (resolve(targetPath) !== resolve(rootReference) || targetSha !== rootSha256) {
    throw new Error(`${label} does not bind the verified root target`);
  }
}

function assertContractTargetBinding(
  contract: Record<string, unknown>,
  rootReference: string,
  rootSha256: string,
  entryIndex: number,
): void {
  const target = requireRecord(
    contract.target,
    `analysis provenance artifact ${entryIndex}.analysisContract.target`,
  );
  const session = requireRecord(
    contract.session,
    `analysis provenance artifact ${entryIndex}.analysisContract.session`,
  );
  const targetId = requireString(target.id, "analysis contract target.id");
  if (requireString(session.targetId, "analysis contract session.targetId") !== targetId) {
    throw new Error(`Analysis provenance artifact ${entryIndex} session targets another binary`);
  }
  const targetPath = requireString(target.filePath, "analysis contract target.filePath");
  const targetSha = requireString(
    target.binarySha256,
    "analysis contract target.binarySha256",
  ).toLowerCase();
  requireSha256(targetSha, "analysis contract target sha256");
  if (resolve(targetPath) !== resolve(rootReference) || targetSha !== rootSha256) {
    throw new Error(`Analysis provenance artifact ${entryIndex} targets another binary`);
  }
}

function uniqueIdentities(
  identities: readonly AnalysisProducerIdentity[],
): AnalysisProducerIdentity[] {
  const seen = new Set<string>();
  return identities.filter((identity) => {
    const key = `${identity.id}\0${identity.version}\0${identity.buildSha256 ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeStatus(value: unknown): AnalysisProducerStatus {
  if (value === "ok") return "ok";
  if (value === "partial" || value === "running") return "partial";
  if (value === "skipped") return "skipped";
  if (value === "error" || value === "failed") return "failed";
  throw new Error(`Unsupported analysis status: ${String(value)}`);
}

function aggregateStatus(
  statuses: readonly AnalysisProducerStatus[],
): AnalysisProducerStatus {
  if (statuses.includes("failed")) return "failed";
  if (statuses.some((status) => status === "partial" || status === "skipped")) {
    return "partial";
  }
  return "ok";
}

function assertDigest(
  actual: Pick<VerifiedResearchArtifact, "sha256">,
  expected: string,
  label: string,
): void {
  if (actual.sha256.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} hash does not match provenance`);
  }
}

function nestedString(value: Record<string, unknown>, path: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return optionalString(current);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireString(value: unknown, label: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function optionalSha256(value: unknown): string | undefined {
  const text = optionalString(value)?.toLowerCase();
  return text && SHA256.test(text) ? text : undefined;
}

function requireSha256(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} is invalid`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function mediaTypeFor(reference: string): string | undefined {
  const lower = reference.toLocaleLowerCase("en-US");
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".java")) return "text/x-java-source";
  if (lower.endsWith(".smali")) return "text/x-smali";
  if (lower.endsWith(".c") || lower.endsWith(".h")) return "text/x-c";
  if (lower.endsWith(".ll") || lower.endsWith(".bc")) return "text/x-llvm";
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain";
  return undefined;
}
