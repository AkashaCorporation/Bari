import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveMcodeDataEnvironment, type McodeDataEnvironment } from '../auth/environment.js';
import { configureTuiRuntimeEnvironment } from '../cli/environment.js';

export type TuiDefaultDataDirResolver = () => string;

export const BARI_DATA_DIR_BASENAME = '.bari';
export const LEGACY_TUI_DATA_DIR_BASENAME = '.minimax-code';

export interface TuiDataDirEnvironment {
  BARI_DATA_DIR?: string;
  MINIMAX_DATA_DIR?: string;
  MAVIS_DATA_DIR?: string;
}

export interface PrepareTuiDataDirOptions {
  environment?: TuiDataDirEnvironment;
  getBuildEnv?: () => McodeDataEnvironment;
  getDefaultDataDir?: TuiDefaultDataDirResolver;
  configureRuntimeEnvironment?: typeof configureTuiRuntimeEnvironment;
}

export function resolveDefaultTuiDataDirAtHome(homeDir: string): string {
  const bariDataDir = join(homeDir, BARI_DATA_DIR_BASENAME);
  if (existsSync(bariDataDir)) return bariDataDir;
  const legacyDataDir = join(homeDir, LEGACY_TUI_DATA_DIR_BASENAME);
  return existsSync(legacyDataDir) ? legacyDataDir : bariDataDir;
}

export function resolveDefaultTuiDataDir(_buildEnv: McodeDataEnvironment): string {
  return resolveDefaultTuiDataDirAtHome(homedir());
}

function getDefaultTuiDataDir(): string {
  return resolveDefaultTuiDataDir(resolveMcodeDataEnvironment());
}

function readDataDirOverride(environment: TuiDataDirEnvironment): string | undefined {
  const bariDataDir = environment.BARI_DATA_DIR?.trim();
  if (bariDataDir) return bariDataDir;

  const minimaxDataDir = environment.MINIMAX_DATA_DIR?.trim();
  if (minimaxDataDir) return minimaxDataDir;

  const mavisDataDir = environment.MAVIS_DATA_DIR?.trim();
  return mavisDataDir || undefined;
}

export function getTuiDataDirPath(
  environment: TuiDataDirEnvironment = process.env,
  getDefaultDataDir: () => string = getDefaultTuiDataDir,
): string {
  return readDataDirOverride(environment) ?? getDefaultDataDir();
}

export function resolveTuiDataDir(
  getDefaultDataDir: TuiDefaultDataDirResolver = getDefaultTuiDataDir,
  environment: TuiDataDirEnvironment = process.env,
): string {
  return getTuiDataDirPath(environment, getDefaultDataDir);
}

export function prepareTuiDataDir(options: PrepareTuiDataDirOptions = {}): Promise<string> {
  const buildEnv = (options.getBuildEnv ?? resolveMcodeDataEnvironment)();
  const dataDir = resolveTuiDataDir(
    options.getDefaultDataDir ?? (() => resolveDefaultTuiDataDir(buildEnv)),
    options.environment ?? process.env,
  );
  (options.configureRuntimeEnvironment ?? configureTuiRuntimeEnvironment)({
    dataDir,
  });
  return Promise.resolve(dataDir);
}
