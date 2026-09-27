import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Windows junctions do not require the symbolic-link privilege. */
export function directoryLink(target: string, link: string): Promise<void> {
  return symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

/** Probe the actual account capability; elevated Windows CI still runs these tests. */
export async function canCreateFileSymlinks(): Promise<boolean> {
  if (process.platform !== 'win32') return true;
  const root = await mkdtemp(join(tmpdir(), 'bari-file-symlink-capability-'));
  try {
    const target = join(root, 'target');
    await writeFile(target, 'synthetic');
    try {
      await symlink(target, join(root, 'link'), 'file');
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return false;
      throw error;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
