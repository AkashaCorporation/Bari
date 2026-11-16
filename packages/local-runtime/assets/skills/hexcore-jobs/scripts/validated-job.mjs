#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const WATCHED_JOB_SUFFIX = '.hexcore_job.json';
const REQUEST_SCHEMA_VERSION = 1;
const RECEIPT_SCHEMA_VERSION = 1;

export async function prepareValidationRequest(input) {
  const workspace = await canonicalDirectory(input.workspace, 'workspace');
  const draft = await canonicalFileInside(workspace, input.draft, 'draft');
  assertInactiveDraft(draft);
  const output = await resolveWritableInside(workspace, input.output, 'published job');
  assertWatchedJob(output);
  if (await pathExists(output)) {
    throw new Error(`Published job already exists: ${output}`);
  }

  const validation = await resolveWritableInside(
    workspace,
    input.validation,
    'validation report',
  );
  const requestPath = await resolveWritableInside(
    workspace,
    input.request,
    'validation request',
  );
  if (await pathExists(requestPath)) {
    throw new Error(`Validation request already exists: ${requestPath}`);
  }
  if (await pathExists(validation)) {
    throw new Error(`Validation report already exists: ${validation}`);
  }
  const raw = await readBoundedFile(draft, 'draft');
  const job = parseJob(raw, draft);
  assertLocalJobShape(job, draft, workspace);
  const createdAt = new Date().toISOString();
  const request = {
    schemaVersion: REQUEST_SCHEMA_VERSION,
    createdAt,
    workspace,
    draft,
    draftSha256: sha256(raw),
    output,
    validation,
    expectedStepCount: job.steps.length,
  };
  await writeJsonAtomically(requestPath, request);
  return { requestPath, request };
}

export async function publishValidatedJob(input) {
  const workspace = await canonicalDirectory(input.workspace, 'workspace');
  const requestPath = await canonicalFileInside(
    workspace,
    input.request,
    'validation request',
  );
  const requestRaw = await readBoundedFile(requestPath, 'validation request');
  const request = parseRequest(requestRaw);
  if (request.workspace !== workspace) {
    throw new Error('Validation request belongs to another workspace');
  }

  const draft = await canonicalFileInside(workspace, input.draft, 'draft');
  const validation = await canonicalFileInside(
    workspace,
    input.validation,
    'validation report',
  );
  const output = await resolveWritableInside(workspace, input.output, 'published job');
  if (
    draft !== request.draft ||
    validation !== request.validation ||
    output !== request.output
  ) {
    throw new Error('Publish arguments do not match the prepared validation request');
  }
  assertInactiveDraft(draft);
  assertWatchedJob(output);
  if (await pathExists(output)) {
    throw new Error(`Published job already exists: ${output}`);
  }

  const draftRaw = await readBoundedFile(draft, 'draft');
  if (sha256(draftRaw) !== request.draftSha256) {
    throw new Error('Draft changed after the validation request was prepared');
  }
  const job = parseJob(draftRaw, draft);
  assertLocalJobShape(job, draft, workspace);

  const validationRaw = await readBoundedFile(validation, 'validation report');
  const report = parseValidationReport(validationRaw);
  if (resolve(report.jobFile) !== draft) {
    throw new Error('Validation report does not bind the prepared draft path');
  }
  if (!report.ok || report.issues.some((issue) => issue.level === 'error')) {
    throw new Error('Canonical HexCore validation did not approve this draft');
  }
  if (report.totalSteps !== request.expectedStepCount || report.totalSteps !== job.steps.length) {
    throw new Error('Validation report step count does not match the prepared draft');
  }
  const requestAt = Date.parse(request.createdAt);
  const validatedAt = Date.parse(report.generatedAt);
  if (!Number.isFinite(validatedAt) || validatedAt < requestAt) {
    throw new Error('Validation report predates the prepared validation request');
  }

  await publishExactBytes(output, draftRaw);
  const receiptPath = await resolveWritableInside(
    workspace,
    input.receipt ?? `${output}.publish-receipt.json`,
    'publication receipt',
  );
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    publishedAt: new Date().toISOString(),
    workspace,
    draft,
    request: requestPath,
    validation,
    output,
    jobSha256: request.draftSha256,
    validationSha256: sha256(validationRaw),
    totalSteps: report.totalSteps,
  };
  await writeJsonAtomically(receiptPath, receipt);
  return { receiptPath, receipt };
}

async function publishExactBytes(output, bytes) {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.${process.pid}-${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await rename(temporary, output);
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  } finally {
    await unlink(temporary).catch((error) => {
      if (!isNodeError(error, 'ENOENT')) throw error;
    });
  }
}

async function writeJsonAtomically(path, value) {
  const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (!isNodeError(error, 'ENOENT')) throw error;
    });
  }
}

function parseJob(raw, path) {
  const value = parseJsonObject(raw, `draft ${path}`);
  if (typeof value.file !== 'string' || !value.file.trim()) {
    throw new Error('Draft requires a non-empty file');
  }
  if (typeof value.outDir !== 'string' || !value.outDir.trim()) {
    throw new Error('Draft requires a non-empty outDir');
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new Error('Draft requires at least one step');
  }
  for (const [index, step] of value.steps.entries()) {
    if (!isRecord(step) || typeof step.cmd !== 'string' || !step.cmd.trim()) {
      throw new Error(`Draft step ${index} requires a non-empty cmd`);
    }
  }
  return value;
}

function assertLocalJobShape(job, draft, workspace) {
  const base = dirname(draft);
  if (!isAbsolute(job.file)) {
    throw new Error('Draft target file must be absolute to avoid process-cwd ambiguity');
  }
  const target = resolve(job.file);
  const outDir = isAbsolute(job.outDir) ? resolve(job.outDir) : resolve(base, job.outDir);
  if (!isInsideOrEqual(target, workspace)) {
    throw new Error('Draft target escapes the workspace');
  }
  if (!isInsideOrEqual(outDir, workspace) && !isInsideOrEqual(outDir, base)) {
    throw new Error('Draft outDir escapes the workspace and job directory');
  }
  for (const [index, step] of job.steps.entries()) {
    const output = isRecord(step.output) ? step.output.path : undefined;
    if (output === undefined) continue;
    if (typeof output !== 'string' || !output.trim() || isAbsolute(output)) {
      throw new Error(`Draft step ${index} output.path must be a relative path`);
    }
    const resolvedOutput = resolve(outDir, output);
    if (!isInsideOrEqual(resolvedOutput, outDir)) {
      throw new Error(`Draft step ${index} output.path escapes outDir`);
    }
  }
}

function parseRequest(raw) {
  const value = parseJsonObject(raw, 'validation request');
  if (
    value.schemaVersion !== REQUEST_SCHEMA_VERSION ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.workspace !== 'string' ||
    typeof value.draft !== 'string' ||
    typeof value.draftSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.draftSha256) ||
    typeof value.output !== 'string' ||
    typeof value.validation !== 'string' ||
    !Number.isSafeInteger(value.expectedStepCount) ||
    value.expectedStepCount < 1
  ) {
    throw new Error('Invalid HexCore validation request');
  }
  return value;
}

function parseValidationReport(raw) {
  const value = parseJsonObject(raw, 'validation report');
  if (
    typeof value.jobFile !== 'string' ||
    typeof value.generatedAt !== 'string' ||
    typeof value.ok !== 'boolean' ||
    !Number.isSafeInteger(value.totalSteps) ||
    !Array.isArray(value.issues) ||
    value.issues.some(
      (issue) => !isRecord(issue) || !['error', 'warning'].includes(issue.level),
    )
  ) {
    throw new Error('Invalid canonical HexCore validation report');
  }
  return value;
}

async function canonicalDirectory(path, label) {
  const declared = resolve(path);
  const declaredInfo = await lstat(declared);
  if (!declaredInfo.isDirectory() || declaredInfo.isSymbolicLink()) {
    throw new Error(`${label} is not a safe directory`);
  }
  const canonical = await realpath(declared);
  const info = await lstat(canonical);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} is not a safe directory`);
  }
  return canonical;
}

async function canonicalFileInside(workspace, path, label) {
  const declared = isAbsolute(path) ? resolve(path) : resolve(workspace, path);
  const declaredInfo = await lstat(declared);
  if (!declaredInfo.isFile() || declaredInfo.isSymbolicLink()) {
    throw new Error(`${label} is not a safe regular file`);
  }
  const canonical = await realpath(declared);
  if (!isInsideOrEqual(canonical, workspace)) {
    throw new Error(`${label} escapes the workspace`);
  }
  const info = await lstat(canonical);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} is not a safe regular file`);
  }
  if (info.size > MAX_JSON_BYTES) throw new Error(`${label} exceeds the size limit`);
  return canonical;
}

function resolveInside(workspace, path, label) {
  const resolved = isAbsolute(path) ? resolve(path) : resolve(workspace, path);
  if (!isInsideOrEqual(resolved, workspace)) {
    throw new Error(`${label} escapes the workspace`);
  }
  return resolved;
}

async function resolveWritableInside(workspace, path, label) {
  const resolved = resolveInside(workspace, path, label);
  const parent = dirname(resolved);
  let parentInfo;
  try {
    parentInfo = await lstat(parent);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      throw new Error(`${label} parent directory does not exist: ${parent}`);
    }
    throw error;
  }
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new Error(`${label} parent is not a safe directory`);
  }
  const canonicalParent = await realpath(parent);
  if (!isInsideOrEqual(canonicalParent, workspace)) {
    throw new Error(`${label} parent escapes the workspace`);
  }
  return join(canonicalParent, basename(resolved));
}

function assertInactiveDraft(path) {
  if (path.toLocaleLowerCase('en-US').endsWith(WATCHED_JOB_SUFFIX)) {
    throw new Error('Draft path matches the HexCore watcher; use *.hexcore_job.draft.json');
  }
}

function assertWatchedJob(path) {
  if (!path.toLocaleLowerCase('en-US').endsWith(WATCHED_JOB_SUFFIX)) {
    throw new Error('Published job must end with .hexcore_job.json');
  }
}

async function readBoundedFile(path, label) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} is not a safe regular file`);
  }
  if (info.size > MAX_JSON_BYTES) throw new Error(`${label} exceeds the size limit`);
  return readFile(path);
}

function parseJsonObject(raw, label) {
  let value;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
  if (!isRecord(value)) throw new Error(`${label} must contain a JSON object`);
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isInsideOrEqual(candidate, root) {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return false;
    throw error;
  }
}

function isNodeError(error, code) {
  return error instanceof Error && 'code' in error && error.code === code;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Arguments must use --name value pairs');
    }
    options[key.slice(2)] = value;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === 'prepare') {
    requireOptions(options, ['workspace', 'draft', 'output', 'validation', 'request']);
    console.log(JSON.stringify(await prepareValidationRequest(options), null, 2));
    return;
  }
  if (command === 'publish') {
    requireOptions(options, ['workspace', 'draft', 'output', 'validation', 'request']);
    console.log(JSON.stringify(await publishValidatedJob(options), null, 2));
    return;
  }
  throw new Error('Usage: validated-job.mjs prepare|publish --workspace PATH --draft PATH --output PATH --validation PATH --request PATH [--receipt PATH]');
}

function requireOptions(options, names) {
  for (const name of names) {
    if (typeof options[name] !== 'string' || !options[name]) {
      throw new Error(`Missing --${name}`);
    }
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
