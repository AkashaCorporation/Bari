import { describe, expect, it } from 'vitest';

import { projectEmbeddedRuntimeConfig } from '../../src/runtime/embedded-host.js';

type EmbeddedRuntimeConfig = Parameters<typeof projectEmbeddedRuntimeConfig>[0];

function project(memoryEnabled: boolean | undefined): EmbeddedRuntimeConfig {
  return projectEmbeddedRuntimeConfig(
    {
      dataDir: '/tmp/bari',
      memory: memoryEnabled === undefined ? undefined : { enabled: memoryEnabled },
    } as unknown as EmbeddedRuntimeConfig,
    { isInternalBuild: false },
    false,
  );
}

describe('embedded runtime config projection', () => {
  it('keeps user Memory enabled for embedded TUI, exec and ACP owners', () => {
    expect(project(true).memory?.enabled).toBe(true);
  });

  it('preserves an explicit user Memory opt-out', () => {
    expect(project(false).memory?.enabled).toBe(false);
  });

  it('does not invent a Memory setting when the user config omits it', () => {
    expect(project(undefined).memory).toBeUndefined();
  });
});
