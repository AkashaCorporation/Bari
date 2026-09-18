#!/usr/bin/env node
/**
 * Build a publishable npm package from dist/.
 *
 * The repository build keeps dist/package.json private; this script rewrites it
 * into the publish manifest (scoped name, bin, engines, runtime native
 * dependencies) and produces a tarball with `npm pack`.
 *
 * Usage:
 *   pnpm pack:npm                 # build, then pack
 *   pnpm pack:npm -- --no-build   # pack the current dist
 *   BARI_NPM_NAME=@scope/name pnpm pack:npm
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const args = new Set(process.argv.slice(2));

if (!args.has('--no-build')) {
  execSync('pnpm build', { cwd: root, stdio: 'inherit' });
}

if (!existsSync(path.join(dist, 'cli.js'))) {
  throw new Error('dist/cli.js is missing; run pnpm build first or drop --no-build.');
}

function dependencyVersion(packageName) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'node_modules', packageName, 'package.json'), 'utf8'),
  );
  return manifest.version;
}

const tuiManifest = JSON.parse(
  readFileSync(path.join(root, 'packages', 'tui', 'package.json'), 'utf8'),
);
const manifest = {
  name: process.env.BARI_NPM_NAME?.trim() || '@akashacorporation/bari',
  version: tuiManifest.version,
  description: 'Bari — a fast terminal coding agent harness by AkashaCorporation.',
  license: 'MIT',
  type: 'module',
  bin: { bari: 'cli.js' },
  engines: { node: '>=22.19 <23 || >=24.2 <27' },
  dependencies: {
    'better-sqlite3': `^${dependencyVersion('better-sqlite3')}`,
    'node-pty': `^${dependencyVersion('node-pty')}`,
  },
  repository: { type: 'git', url: 'git+https://github.com/AkashaCorporation/Bari.git' },
  homepage: 'https://github.com/AkashaCorporation/Bari#readme',
  bugs: { url: 'https://github.com/AkashaCorporation/Bari/issues' },
  keywords: ['ai-agent', 'coding-agent', 'cli', 'tui', 'acp', 'mcp', 'harness'],
};
writeFileSync(path.join(dist, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

for (const entry of readdirSync(dist)) {
  if (entry.endsWith('.tgz')) rmSync(path.join(dist, entry), { force: true });
}

const output = execSync('npm pack --json', { cwd: dist, encoding: 'utf8' });
const [packed] = JSON.parse(output);
const tarball = path.join(dist, packed.filename);
const sizeMb = (statSync(tarball).size / 1024 / 1024).toFixed(1);
console.log(`Packed ${manifest.name}@${manifest.version} -> ${tarball} (${sizeMb} MB)`);
console.log(`Files in tarball: ${packed.entryCount}`);
