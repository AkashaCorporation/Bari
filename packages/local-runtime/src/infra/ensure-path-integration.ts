/**
 * Add `<dataDir>/bin` to the user's shell or user-level PATH so that
 * `mavis`, `minimax`, and `mavis-trash` are available in new terminal
 * sessions.
 *
 * Ephemeral data directories (anything below the OS temp directory, which is
 * what tests and `BARI_DATA_DIR` overrides use) are never persisted: a temp
 * path must not outlive the directory it points at. On Windows the planner
 * also prunes stale temp entries a previous run may have left behind, so a
 * polluted user PATH self-heals the next time a real data directory starts.
 *
 * Best-effort: failures are swallowed — PATH integration must never block
 * local-runtime startup.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const PATH_MARKER = '# Added by Bari';

export function ensurePathIntegration(dataDir: string): void {
  const binDir = join(dataDir, 'bin');

  try {
    if (isPathInsideDirectory(binDir, tmpdir())) return;
    if (process.platform === 'darwin' || process.platform === 'linux') {
      ensurePosixShellPath(binDir);
    } else if (process.platform === 'win32') {
      ensureWindowsUserPath(binDir);
    }
  } catch {
    // Best-effort — never block startup.
  }
}

/**
 * Pure planning for the Windows user PATH: drops entries below the OS temp
 * directory, ensures `binDir` is present exactly once, and returns `undefined`
 * when the stored value is already correct.
 */
export function planWindowsUserPath(input: {
  readonly currentPath: string;
  readonly binDir: string;
  readonly tempDir: string;
}): string | undefined {
  const entries = input.currentPath
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const entry of entries) {
    if (isPathInsideDirectory(entry, input.tempDir)) continue;
    const key = normalizedPath(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(entry);
  }
  const hasBinDir = seen.has(normalizedPath(input.binDir));
  const next = hasBinDir ? kept : [input.binDir, ...kept];
  const nextPath = next.join(';');
  return nextPath === entries.join(';') ? undefined : nextPath;
}

function normalizedPath(value: string): string {
  const resolved = resolve(value).replace(/\\/gu, '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInsideDirectory(candidate: string, directory: string): boolean {
  const dir = normalizedPath(directory).replace(/\/+$/u, '');
  const target = normalizedPath(candidate);
  return target === dir || target.startsWith(`${dir}/`);
}

// ---------------------------------------------------------------------------
// POSIX (macOS / Linux)
// ---------------------------------------------------------------------------

function ensurePosixShellPath(binDir: string): void {
  const home = homedir();
  const rcFiles =
    process.platform === 'darwin'
      ? [join(home, '.zshrc'), join(home, '.bashrc')]
      : [join(home, '.bashrc')];
  const exportLine = `export PATH="${binDir}:$PATH"`;

  for (const rc of rcFiles) {
    try {
      const content = existsSync(rc) ? readFileSync(rc, 'utf-8') : '';
      if (content.includes(PATH_MARKER)) continue;
      appendFileSync(rc, `\n${PATH_MARKER}\n${exportLine}\n`);
    } catch {
      // Individual shell config failures must not prevent updating the next one.
    }
  }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function ensureWindowsUserPath(binDir: string): void {
  // Use execFileSync (not execSync) so cmd.exe does not expand values such as
  // %USERPROFILE% while the existing PATH is being read or written.
  let currentPath = '';
  let registryType = 'REG_EXPAND_SZ';

  try {
    // Query the whole key: a successful listing can prove Path is absent.
    // A failed /v Path query cannot distinguish absence from read errors.
    const queryResult = execFileSync('reg', ['query', 'HKCU\\Environment'], {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Do not persist text that could not be decoded losslessly.
    if (queryResult.includes('\uFFFD')) return;
    const lines = queryResult.split(/\r?\n/).filter((line) => line.trim());
    if (lines.shift()?.trim().toLowerCase() !== 'hkey_current_user\\environment') return;
    let foundPath = false;
    for (const line of lines) {
      const value = line.match(/^\s+(.+?)\s+(REG_\w+)(?:[ \t]+(.*))?$/);
      // Never interpret unrecognized or partial output as a missing value.
      if (!value?.[1] || !value[2]) return;
      if (value[1].toLowerCase() !== 'path') continue;
      if (foundPath || !['REG_SZ', 'REG_EXPAND_SZ'].includes(value[2])) return;
      foundPath = true;
      registryType = value[2];
      currentPath = value[3] ?? '';
    }
  } catch {
    // Timeout, access errors, missing key, etc. must never trigger an overwrite.
    return;
  }

  const newPath = planWindowsUserPath({ currentPath, binDir, tempDir: tmpdir() });
  if (newPath === undefined) return;
  execFileSync(
    'reg',
    ['add', 'HKCU\\Environment', '/v', 'Path', '/t', registryType, '/d', newPath, '/f'],
    { timeout: 5000, stdio: 'ignore', windowsHide: true },
  );
}
