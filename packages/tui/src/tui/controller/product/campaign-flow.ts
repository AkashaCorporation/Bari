import type { ResearchCampaignCommandResult } from "@bari/local-runtime-v2/cli-service";

import type { TuiRuntime, TuiSession } from "../../../runtime/port.js";
import {
  TuiResearchCampaignPanel,
  type TuiResearchCampaignAction,
} from "../../security-campaign/panel.js";
import type {
  TuiFeatureScreenHandle,
  TuiSurfaceHost,
} from "../../shell/surface-host.js";

export interface TuiCampaignFlowOptions {
  readonly runtime: Pick<TuiRuntime, "executeResearchCampaignCommand">;
  readonly currentSession: () => TuiSession | undefined;
  readonly surfaceHost: Pick<TuiSurfaceHost, "pushFeature">;
  readonly append: (message: string, kind?: "warning" | "error") => void;
  readonly requestRender: () => void;
}

export class TuiCampaignFlow {
  private handle?: TuiFeatureScreenHandle;
  private opening = false;

  constructor(private readonly options: TuiCampaignFlowOptions) {}

  async show(): Promise<void> {
    if (this.opening || this.handle?.isActive()) return;
    const sessionId = this.options.currentSession()?.sessionId;
    if (!sessionId) {
      this.options.append(
        "Start or resume a Session before opening security campaigns.",
        "warning",
      );
      return;
    }
    const command = this.options.runtime.executeResearchCampaignCommand;
    if (!command) {
      this.options.append(
        "Security campaigns are unavailable in this Runtime.",
        "error",
      );
      return;
    }

    this.opening = true;
    try {
      const execute = async (
        action: TuiResearchCampaignAction,
      ): Promise<ResearchCampaignCommandResult> => {
        if (this.options.currentSession()?.sessionId !== sessionId) {
          throw new Error(
            "The selected session changed. Close and reopen /campaign.",
          );
        }
        return command.call(this.options.runtime, { ...action, sessionId });
      };
      const initial = await execute({ action: "status" });
      if (this.options.currentSession()?.sessionId !== sessionId) return;
      const panel = new TuiResearchCampaignPanel({
        initial,
        execute,
        onCancel: () => this.handle?.close(),
        requestRender: this.options.requestRender,
      });
      this.handle = this.options.surfaceHost.pushFeature({
        screen: panel,
        focus: panel,
      });
    } catch (error) {
      this.options.append(
        `Security campaigns: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    } finally {
      this.opening = false;
    }
  }
}
