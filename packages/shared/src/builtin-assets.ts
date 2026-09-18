import { access, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Single source of truth for locating packaged Bari assets (`agents/`,
 * `skills/`) across every supported layout:
 *
 * - source checkout (module-relative walk-up),
 * - esbuild bundle (`dist/chunks/*` -> `dist/assets/*`),
 * - installed package (`<package>/assets/*`, resolved from the CLI entry),
 * - any working directory (entry-point and cwd fallbacks),
 * - explicit overrides from the environment or the caller.
 */
export type BuiltinAssetKind = 'agents' | 'skills';

export interface BuiltinAssetLookupOptions {
  readonly moduleUrl?: string | URL;
  readonly entry?: string | undefined;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly explicit?: string | undefined;
}

const ASSET_ENV_OVERRIDES: Record<BuiltinAssetKind, readonly string[]> = {
  agents: ['MAVIS_BUILTIN_AGENTS_V2_DIR', 'MAVIS_BUILTIN_AGENTS_DIR'],
  skills: ['MAVIS_BUILTIN_SKILLS_DIR'],
};

const MODULE_WALK_UP_DEPTH = 6;
const AGENTS_MARKER_FILE = 'builtin-agents.json';

export function builtinAssetDirCandidates(
  kind: BuiltinAssetKind,
  options: BuiltinAssetLookupOptions = {},
): string[] {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const entry = options.entry ?? process.argv[1];
  const candidates: Array<string | undefined> = [options.explicit];

  const genericRoot = env.BARI_ASSETS_DIR?.trim();
  if (genericRoot) candidates.push(join(genericRoot, kind));
  for (const name of ASSET_ENV_OVERRIDES[kind]) {
    const value = env[name]?.trim();
    if (value) candidates.push(value);
  }

  if (options.moduleUrl !== undefined) {
    let base = dirname(fileURLToPath(options.moduleUrl));
    for (let depth = 0; depth <= MODULE_WALK_UP_DEPTH; depth += 1) {
      candidates.push(join(base, 'assets', kind));
      base = dirname(base);
    }
  }

  if (entry) candidates.push(join(dirname(entry), 'assets', kind));

  candidates.push(
    join(cwd, 'assets', kind),
    join(cwd, 'packages', 'local-runtime-v2', 'assets', kind),
    join(cwd, 'packages', 'local-runtime', 'assets', kind),
    join(cwd, 'node_modules', '@bari', 'local-runtime-v2', 'assets', kind),
    join(cwd, 'node_modules', '@bari', 'local-runtime', 'assets', kind),
  );

  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

export async function resolveBuiltinAssetDir(
  kind: BuiltinAssetKind,
  options: BuiltinAssetLookupOptions = {},
): Promise<string | undefined> {
  for (const candidate of builtinAssetDirCandidates(kind, options)) {
    if (await isBuiltinAssetDir(kind, candidate)) return candidate;
  }
  return undefined;
}

export async function requireBuiltinAssetDir(
  kind: BuiltinAssetKind,
  options: BuiltinAssetLookupOptions = {},
): Promise<string> {
  const resolved = await resolveBuiltinAssetDir(kind, options);
  if (!resolved) throw new Error(`Built-in ${kind} assets are missing.`);
  return resolved;
}

async function isBuiltinAssetDir(kind: BuiltinAssetKind, directory: string): Promise<boolean> {
  try {
    const metadata = await stat(directory);
    if (!metadata.isDirectory()) return false;
  } catch {
    return false;
  }
  if (kind === 'agents') {
    try {
      await access(join(directory, AGENTS_MARKER_FILE));
    } catch {
      return false;
    }
  }
  return true;
}
