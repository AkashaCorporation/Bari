import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { builtinAssetDirCandidates, resolveBuiltinAssetDir } from './builtin-assets.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bari-builtin-assets-'));
  temporaryDirectories.push(root);
  return root;
}

describe('builtin asset resolution', () => {
  it('prefers explicit overrides and covers entry-point, module, and cwd layouts', () => {
    const candidates = builtinAssetDirCandidates('agents', {
      explicit: 'C:/override/agents',
      moduleUrl: 'file:///C:/app/dist/chunks/entry.js',
      entry: 'C:/app/dist/cli.js',
      cwd: 'C:/workspace',
      env: {},
    }).map((candidate) => normalize(candidate));

    expect(candidates[0]).toBe(normalize('C:/override/agents'));
    expect(candidates).toContain(normalize('C:/app/dist/assets/agents'));
    expect(candidates).toContain(normalize('C:/workspace/packages/local-runtime-v2/assets/agents'));
  });

  it('honors environment overrides before filesystem candidates', () => {
    const candidates = builtinAssetDirCandidates('skills', {
      entry: '',
      moduleUrl: undefined,
      cwd: 'C:/workspace',
      env: { BARI_ASSETS_DIR: 'C:/assets-root', MAVIS_BUILTIN_SKILLS_DIR: 'C:/skills-override' },
    }).map((candidate) => normalize(candidate));

    expect(candidates[0]).toBe(normalize('C:/assets-root/skills'));
    expect(candidates[1]).toBe(normalize('C:/skills-override'));
  });

  it('resolves agent and skill directories with their layout markers', async () => {
    const root = temporaryRoot();
    const agentsDir = join(root, 'assets', 'agents');
    const skillsDir = join(root, 'assets', 'skills');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'builtin-agents.json'), '["mavis"]');

    await expect(
      resolveBuiltinAssetDir('agents', { explicit: agentsDir, entry: '', moduleUrl: undefined }),
    ).resolves.toBe(agentsDir);
    await expect(
      resolveBuiltinAssetDir('skills', { explicit: skillsDir, entry: '', moduleUrl: undefined }),
    ).resolves.toBe(skillsDir);
  });

  it('does not treat a directory without the agent roster as the agent root', async () => {
    const empty = temporaryRoot();
    await expect(
      resolveBuiltinAssetDir('agents', {
        explicit: empty,
        entry: '',
        moduleUrl: undefined,
        cwd: empty,
        env: {},
      }),
    ).resolves.toBeUndefined();
  });
});
