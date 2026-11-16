import type {
  CliService,
  ResearchCampaignCommandRequest,
  ResearchCampaignCommandResult,
} from "@bari/local-runtime-v2/cli-service";

/** Process-local API only: campaign identity, evidence gates and persistence stay in Runtime. */
export class TuiCampaignAccess {
  constructor(
    private readonly service: Pick<
      CliService,
      "executeResearchCampaignCommand"
    >,
  ) {}

  executeResearchCampaignCommand(
    request: ResearchCampaignCommandRequest,
  ): Promise<ResearchCampaignCommandResult> {
    if (typeof this.service.executeResearchCampaignCommand !== "function") {
      return Promise.reject(
        new Error("Security campaigns are unavailable in this Runtime."),
      );
    }
    return this.service.executeResearchCampaignCommand(request);
  }
}
