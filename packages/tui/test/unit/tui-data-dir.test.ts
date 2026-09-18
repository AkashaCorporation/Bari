import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getTuiDataDirPath,
  resolveDefaultTuiDataDirAtHome,
} from '../../src/runtime/data-dir.js';

describe('TUI data directory identity', () => {
  it('prefers BARI_DATA_DIR and keeps legacy overrides working', () => {
    expect(
      getTuiDataDirPath(
        { BARI_DATA_DIR: '/bari', MINIMAX_DATA_DIR: '/minimax', MAVIS_DATA_DIR: '/mavis' },
        () => '/default',
      ),
    ).toBe('/bari');
    expect(
      getTuiDataDirPath({ MINIMAX_DATA_DIR: '/minimax', MAVIS_DATA_DIR: '/mavis' }, () => '/default'),
    ).toBe('/minimax');
    expect(getTuiDataDirPath({ MAVIS_DATA_DIR: '/mavis' }, () => '/default')).toBe('/mavis');
    expect(getTuiDataDirPath({}, () => '/default')).toBe('/default');
  });

  it('uses .bari for new homes and reuses an existing .minimax-code profile', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'bari-data-dir-'));
    try {
      expect(resolveDefaultTuiDataDirAtHome(homeDir)).toBe(join(homeDir, '.bari'));
      mkdirSync(join(homeDir, '.minimax-code'));
      expect(resolveDefaultTuiDataDirAtHome(homeDir)).toBe(join(homeDir, '.minimax-code'));
      mkdirSync(join(homeDir, '.bari'));
      expect(resolveDefaultTuiDataDirAtHome(homeDir)).toBe(join(homeDir, '.bari'));
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
