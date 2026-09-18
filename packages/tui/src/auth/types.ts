import type { MavisBuildEnv, MavisRegion } from '@bari/config';

export interface CliAuthScope {
  readonly region: MavisRegion;
  readonly buildEnv: MavisBuildEnv;
}
