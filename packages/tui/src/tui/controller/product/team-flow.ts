import type { TeamCommandResult } from '@bari/local-runtime-v2/cli-service';
import type { TuiRuntime, TuiSession } from '../../../runtime/port.js';
import { TuiTeamPresetPanel, type TuiTeamAction } from '../../agent-team/preset-panel.js';
import type { TuiFeatureScreenHandle, TuiSurfaceHost } from '../../shell/surface-host.js';

export interface TuiTeamFlowOptions {
  readonly runtime: Pick<TuiRuntime, 'executeTeamCommand' | 'listModels'>;
  readonly currentSession: () => TuiSession | undefined;
  readonly surfaceHost: Pick<TuiSurfaceHost, 'pushFeature'>;
  readonly showTasks: () => void | Promise<void>;
  readonly append: (message: string, kind?: 'warning' | 'error') => void;
  readonly requestRender: () => void;
}

export class TuiTeamFlow {
  private handle?: TuiFeatureScreenHandle;
  private opening = false;

  constructor(private readonly options: TuiTeamFlowOptions) {}

  async show(): Promise<void> {
    if (this.opening || this.handle?.isActive()) return;
    const sessionId = this.options.currentSession()?.sessionId;
    if (!sessionId) {
      this.options.append('Start or resume a Session before opening Agent Teams.', 'warning');
      return;
    }
    const command = this.options.runtime.executeTeamCommand;
    if (!command) {
      this.options.append('Agent Teams is unavailable in this Runtime.', 'error');
      return;
    }
    this.opening = true;
    try {
      const execute = async (action: TuiTeamAction) => {
        if (this.options.currentSession()?.sessionId !== sessionId) {
          throw new Error('The selected session changed. Close and reopen /team.');
        }
        return command.call(this.options.runtime, { ...action, sessionId });
      };
      const [catalog, models] = await Promise.all([
        execute({ action: 'list' }), this.options.runtime.listModels(sessionId),
      ]);
      let status: TeamCommandResult | undefined;
      try { status = await execute({ action: 'status' }); }
      catch (error) {
        this.options.append(`Agent Teams status: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
      if (this.options.currentSession()?.sessionId !== sessionId) return;
      const initial = { ...catalog };
      if (status) {
        if (status.snapshot) initial.snapshot = status.snapshot;
        else delete initial.snapshot;
      }
      const panel = new TuiTeamPresetPanel({
        initial,
        models,
        execute,
        onTasks: async () => { this.handle?.close(); await this.options.showTasks(); },
        onCancel: () => { this.handle?.close(); },
        requestRender: this.options.requestRender,
      });
      this.handle = this.options.surfaceHost.pushFeature({ screen: panel, focus: panel });
    } catch (error) {
      this.options.append(`Agent Teams: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally { this.opening = false; }
  }
}
