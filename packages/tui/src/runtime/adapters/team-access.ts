import type {
  CliService,
  TeamCommandRequest,
  TeamCommandResult,
} from '@bari/local-runtime-v2/cli-service';

/** Process-local API only: persistence, caller authority and policy stay in Runtime. */
export class TuiTeamAccess {
  constructor(private readonly service: Pick<CliService, 'executeTeamCommand'>) {}

  executeTeamCommand(request: TeamCommandRequest): Promise<TeamCommandResult> {
    if (typeof this.service.executeTeamCommand !== 'function') {
      return Promise.reject(new Error('Agent Teams is unavailable in this Runtime.'));
    }
    return this.service.executeTeamCommand(request);
  }
}
