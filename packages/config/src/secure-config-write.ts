import fs from 'node:fs';

/**
 * Writes a config file with owner-only permissions. Config files can hold
 * provider API keys, so POSIX systems must not expose them to other local
 * users. Windows has no chmod equivalent here; ACLs stay untouched.
 */
export function writeConfigFileSecure(configPath: string, content: string): void {
  fs.writeFileSync(configPath, content, { encoding: 'utf-8', mode: 0o600 });
  restrictConfigFilePermissions(configPath);
}

/** Tightens an already-written config file (for example after a copy). */
export function restrictConfigFilePermissions(configPath: string): void {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // Tightening permissions is best effort; the write itself already succeeded.
  }
}
