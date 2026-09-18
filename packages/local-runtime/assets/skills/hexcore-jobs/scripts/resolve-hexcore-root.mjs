#!/usr/bin/env node
/**
 * Resolve a HexCore checkout or installation root without hardcoding machine paths.
 * Order: --root/HEXCORE_ROOT, then a bounded workspace scan for checkout markers.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MARKERS = [
  '.agent/skills/hexcore/SKILL.md',
  'extensions/hexcore-disassembler/src/automationPipelineRunner.ts',
  'docs/HEXCORE_AUTOMATION.md',
];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.cache', 'coverage']);
const MAX_DEPTH = 4;
const MAX_ENTRIES = 20000;

const argv = process.argv.slice(2);
let workspace = process.cwd();
let explicitRoot;
let json = false;
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--workspace' && argv[index + 1]) workspace = resolve(argv[++index]);
  else if (arg === '--root' && argv[index + 1]) explicitRoot = resolve(argv[++index]);
  else if (arg === '--json') json = true;
}

function isHexcoreRoot(directory) {
  return MARKERS.some((marker) => existsSync(join(directory, marker)));
}

function succeed(root, source) {
  if (json) console.log(JSON.stringify({ root, source }));
  else console.log(root);
  process.exit(0);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const envRoot = explicitRoot || process.env.HEXCORE_ROOT?.trim();
if (envRoot) {
  const absolute = resolve(envRoot);
  if (isHexcoreRoot(absolute)) succeed(absolute, explicitRoot ? 'argument' : 'HEXCORE_ROOT');
  fail(
    `HEXCORE_ROOT points at ${absolute}, but it is not a HexCore checkout. ` +
      `Expected one of: ${MARKERS.join(', ')}`,
  );
}

let visited = 0;
function scan(directory, depth) {
  if (visited > MAX_ENTRIES || depth > MAX_DEPTH) return undefined;
  if (isHexcoreRoot(directory)) return directory;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    visited += 1;
    if (visited > MAX_ENTRIES) return undefined;
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const found = scan(join(directory, entry.name), depth + 1);
    if (found) return found;
  }
  return undefined;
}

const resolvedWorkspace = resolve(workspace);
const found = scan(resolvedWorkspace, 0);
if (found) succeed(found, 'workspace scan');

fail(
  [
    'HexCore root not found.',
    'Set HEXCORE_ROOT, pass --root <path>, or clone the checkout inside the workspace:',
    '  git clone --depth 1 https://github.com/AkashaCorporation/HikariSystem-HexCore.git .hexcore',
  ].join('\n'),
);
