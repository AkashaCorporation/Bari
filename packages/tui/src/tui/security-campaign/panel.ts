import type {
  ResearchCampaign,
  ResearchCampaignCommandRequest,
  ResearchCampaignCommandResult,
  ResearchHypothesis,
} from "@bari/local-runtime-v2/cli-service";

import { matchesKey, VStack, type Component } from "../engine/public.js";
import { sanitizeTerminalText } from "../rendering/terminal-text.js";
import { truncateToWidth, wrapTextWithAnsi } from "../rendering/text.js";
import type { TuiFeatureScreen } from "../shell/surface-host.js";
import {
  panelContentWidth,
  renderPanelBottom,
  renderPanelDivider,
  renderPanelFooter,
  renderPanelHeader,
  renderPanelRow,
} from "../widgets/panel-frame.js";
import { TuiSelectionScrollView } from "../widgets/selection-scroll-view.js";

export type TuiResearchCampaignAction =
  ResearchCampaignCommandRequest extends infer Request
    ? Request extends ResearchCampaignCommandRequest
      ? Omit<Request, "sessionId">
      : never
    : never;

interface Choice {
  label: string;
  select: () => void | Promise<void>;
}

export interface TuiResearchCampaignPanelOptions {
  readonly initial: ResearchCampaignCommandResult;
  readonly execute: (
    action: TuiResearchCampaignAction,
  ) => Promise<ResearchCampaignCommandResult>;
  readonly onCancel: () => void;
  readonly requestRender: () => void;
}

/** Read-oriented campaign dashboard. Research mutations remain agent/runtime governed. */
export class TuiResearchCampaignPanel implements TuiFeatureScreen {
  readonly id = "security-campaign";
  readonly layoutRoot: Component;

  private readonly viewport: TuiSelectionScrollView;
  private result: ResearchCampaignCommandResult;
  private choices: Choice[] = [];
  private details: string[] = [];
  private title = "Security campaign";
  private notice = "";
  private selected = 0;
  private busy = false;
  private disposed = false;
  private focusedValue = false;
  private back: () => void;

  constructor(private readonly options: TuiResearchCampaignPanelOptions) {
    this.result = options.initial;
    this.back = options.onCancel;
    const header: Component = {
      render: (width) => [
        renderPanelHeader(safe(this.title), undefined, width),
      ],
      invalidate() {},
    };
    const body: Component = {
      render: (width) => this.renderBody(width),
      invalidate() {},
    };
    const footer: Component = {
      render: (width) => this.renderFooter(width),
      invalidate() {},
    };
    this.viewport = new TuiSelectionScrollView(body, {
      primary: true,
      overscroll: "contain",
    });
    this.layoutRoot = new VStack([
      { component: header, basis: "auto", shrink: 1, minSize: 1 },
      { component: this.viewport, basis: 0, grow: 1, shrink: 1, minSize: 1 },
      { component: footer, basis: "auto", shrink: 1, minSize: 1 },
    ]);
    this.home();
  }

  get focused(): boolean {
    return this.focusedValue;
  }

  set focused(value: boolean) {
    this.focusedValue = value;
  }

  invalidate(): void {
    this.layoutRoot.invalidate();
  }

  dispose(): void {
    this.disposed = true;
  }

  render(width: number): string[] {
    return [
      renderPanelHeader(safe(this.title), undefined, width),
      ...this.renderBody(width),
      ...this.renderFooter(width),
    ];
  }

  handleInput(data: string): void {
    if (this.disposed) return;
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      if (!this.busy) this.back();
      return;
    }
    if (this.busy) return;
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      const delta = matchesKey(data, "up") ? -1 : 1;
      this.selected =
        (this.selected + delta + this.choices.length) %
        Math.max(1, this.choices.length);
      this.changed();
      return;
    }
    if (matchesKey(data, "enter")) {
      const choice = this.choices[this.selected];
      if (choice) void this.guard(choice.select);
    }
  }

  private changed(): void {
    if (!this.disposed) this.options.requestRender();
  }

  private menu(
    title: string,
    details: string[],
    choices: Choice[],
    back: () => void = () => this.home(),
  ): void {
    this.title = title;
    this.details = details;
    this.choices = choices;
    this.selected = 0;
    this.back = back;
    this.changed();
  }

  private async guard(work: () => void | Promise<void>): Promise<void> {
    this.busy = true;
    this.notice = "";
    this.changed();
    try {
      await work();
    } catch (error) {
      this.notice = `Error: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.busy = false;
      this.changed();
    }
  }

  private async execute(action: TuiResearchCampaignAction): Promise<void> {
    this.result = await this.options.execute(action);
    this.notice = this.result.message;
  }

  private async refresh(): Promise<void> {
    await this.execute({ action: "status" });
    this.home();
  }

  private home(): void {
    const campaign = this.result.snapshot;
    const details = campaign
      ? campaignDetails(campaign)
      : [
          "No active campaign is attached to this session lineage.",
          "Ask Bari to create one with an exact target, authorization scope and frozen identifiers.",
        ];
    const choices: Choice[] = [
      { label: "Refresh campaign status", select: () => this.refresh() },
      ...(campaign
        ? campaign.hypotheses.map((hypothesis): Choice => ({
            label: `${statusBadge(hypothesis.status)} ${hypothesis.title} · r${hypothesis.revision}`,
            select: () => this.hypothesis(campaign, hypothesis),
          }))
        : []),
      ...(campaign?.status === "active"
        ? [
            {
              label: "Archive campaign…",
              select: () => this.confirmArchive(campaign),
            },
          ]
        : []),
      ...(this.result.campaigns ?? [])
        .filter((entry) => entry.id !== campaign?.id)
        .map((entry): Choice => ({
          label: `[${entry.status.toUpperCase()}] ${entry.title} · ${entry.targetName}`,
          select: () =>
            this.menu(
              `Campaign: ${entry.title}`,
              [
                `ID: ${entry.id}`,
                `Status: ${entry.status} · revision ${entry.revision}`,
                `Target: ${entry.targetName}`,
                `Hypotheses: ${formatCounts(entry.hypothesisCounts)}`,
                "Archived campaign details remain in Runtime; activate a new campaign rather than mutating frozen history.",
              ],
              [],
            ),
        })),
    ];
    this.menu("Security campaign", details, choices, () =>
      this.options.onCancel(),
    );
  }

  private hypothesis(
    campaign: ResearchCampaign,
    hypothesis: ResearchHypothesis,
  ): void {
    const evidence = campaign.evidence.filter(
      (entry) => entry.hypothesisId === hypothesis.id,
    );
    const experiments = campaign.experiments.filter(
      (entry) => entry.hypothesisId === hypothesis.id,
    );
    const duplicateChecks = campaign.duplicateChecks.filter(
      (entry) => entry.hypothesisId === hypothesis.id,
    );
    const analysisReceipts = campaign.analysisReceipts.filter(
      (entry) => entry.hypothesisId === hypothesis.id,
    );
    this.menu(
      `Hypothesis: ${hypothesis.title}`,
      [
        `${statusBadge(hypothesis.status)} ID ${hypothesis.id} · revision ${hypothesis.revision}`,
        `Fingerprint: ${hypothesis.fingerprint.key}`,
        `Invariant: ${hypothesis.invariant}`,
        `Affected scope: ${hypothesis.affectedScope}`,
        `Agent Teams task: ${hypothesis.teamTaskId ?? "not linked"} · scheduling state is not a verdict`,
        `Lease: ${hypothesis.lease ? `${hypothesis.lease.ownerSessionId} until ${new Date(hypothesis.lease.expiresAtMs).toISOString()}` : "unclaimed"}`,
        `Evidence: ${evidence.length} · analysis receipts: ${analysisReceipts.length} · experiments: ${experiments.length} · duplicate checks: ${duplicateChecks.length} · reviews: ${hypothesis.reviews.length}`,
        ...analysisReceipts.flatMap((receipt) => {
          const effectiveInputs = receipt.artifacts.filter(
            (artifact) => artifact.role === "effective-input",
          );
          const outputs = receipt.artifacts.filter(
            (artifact) => artifact.role === "output",
          );
          return [
            `[ANALYSIS ${receipt.status.toUpperCase()}${receipt.producer.experimental ? " · EXPERIMENTAL" : ""}] ${receipt.producer.kind} · ${receipt.id}`,
            `  Root ${shortDigest(receipt.rootTarget.sha256)} · effective inputs ${effectiveInputs.map((artifact) => `${shortDigest(artifact.sha256)}:${artifact.verification}`).join(", ") || "none"} · outputs ${outputs.length}`,
            `  Coverage ${receipt.coverage.okSteps}/${receipt.coverage.totalSteps} ok · ${receipt.coverage.complete ? "complete" : `partial: ${receipt.coverage.partialReasons.join("; ")}`}`,
          ];
        }),
        ...evidence.map(
          (entry) =>
            `[EVIDENCE ${entry.verification.toUpperCase()} · ${entry.kind}] ${entry.id} · ${entry.supports.join(", ")} · ${entry.reference}${entry.locator ? ` @ ${entry.locator}` : ""}`,
        ),
        ...experiments.map(
          (entry) =>
            `[EXPERIMENT ${entry.outcome.toUpperCase()}] ${entry.title} · negative control ${entry.negativeControl.outcome}`,
        ),
        ...duplicateChecks.map(
          (entry) =>
            `[DUPLICATE ${entry.assessment.toUpperCase()}] ${entry.reasoning}`,
        ),
        ...hypothesis.reviews.map(
          (entry) =>
            `[REVIEW ${entry.decision.toUpperCase()}] ${entry.reviewerSessionId} · ${entry.blind ? "blind" : "not blind"} · revision ${entry.reviewedRevision}`,
        ),
        ...(hypothesis.verdictRationale
          ? [`Verdict rationale: ${hypothesis.verdictRationale}`]
          : []),
      ],
      [{ label: "Refresh campaign", select: () => this.refresh() }],
      () => this.home(),
    );
  }

  private confirmArchive(campaign: ResearchCampaign): void {
    this.menu(
      "Archive security campaign?",
      [
        campaign.title,
        "This preserves all evidence and negative results. Active hypothesis leases must be released first.",
      ],
      [
        { label: "Keep campaign active", select: () => this.home() },
        {
          label: "Confirm archive",
          select: async () => {
            await this.execute({
              action: "archive-campaign",
              expectedRevision: campaign.revision,
            });
            this.home();
          },
        },
      ],
      () => this.home(),
    );
  }

  private renderBody(width: number): string[] {
    const inner = panelContentWidth(width);
    if (inner <= 0) return [];
    const details = this.details.flatMap((line) =>
      wrapTextWithAnsi(safe(line), inner),
    );
    this.viewport.setActiveRow(details.length + this.selected);
    const lines = [
      ...details,
      ...this.choices.map(
        (choice, index) =>
          `${index === this.selected ? ">" : " "} ${safe(choice.label)}`,
      ),
    ];
    while (lines.length < this.viewport.viewportHeight) lines.push("");
    return lines.map((line) =>
      renderPanelRow(truncateToWidth(line, inner, ""), width),
    );
  }

  private renderFooter(width: number): string[] {
    const text = `${this.busy ? "[~] Working · " : ""}${safe(this.notice)}${this.notice ? "\n" : ""}Up/Down select · Enter open · PgUp/PgDn scroll · Esc back`;
    return [
      renderPanelDivider(width),
      ...renderPanelFooter(text, panelContentWidth(width)).map((line) =>
        renderPanelRow(line, width),
      ),
      renderPanelBottom(width),
    ];
  }
}

function campaignDetails(campaign: ResearchCampaign): string[] {
  return [
    `${campaign.status.toUpperCase()} · revision ${campaign.revision} · root ${campaign.rootSessionId}`,
    `Target: ${campaign.target.name} (${campaign.target.kind})`,
    `Freeze SHA-256: ${campaign.freezeDigest}`,
    `Identifiers: ${campaign.target.identifiers.map((entry) => `${entry.kind}=${entry.value}`).join("; ")}`,
    `Program: ${campaign.scope.program}`,
    `Allowed: ${campaign.scope.allowedActions.join("; ")}`,
    `Excluded: ${campaign.scope.excludedActions.join("; ") || "none recorded"}`,
    `Hypotheses: ${formatHypothesisCounts(campaign.hypotheses)}`,
    `Analysis receipts: ${campaign.analysisReceipts.length} · tool output never promotes a verdict automatically`,
    "Runtime status is not a verdict. Reportable requires complete evidence and fresh independent review.",
  ];
}

function formatHypothesisCounts(
  hypotheses: readonly ResearchHypothesis[],
): string {
  const counts: Partial<Record<ResearchHypothesis["status"], number>> = {};
  for (const hypothesis of hypotheses) {
    counts[hypothesis.status] = (counts[hypothesis.status] ?? 0) + 1;
  }
  return formatCounts(counts);
}

function shortDigest(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 12)}…${value.slice(-4)}`;
}

function formatCounts(
  counts: Readonly<Record<string, number | undefined>>,
): string {
  const entries = Object.entries(counts).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
  return entries.length > 0
    ? entries.map(([status, count]) => `${status}=${count}`).join(", ")
    : "none";
}

function statusBadge(status: ResearchHypothesis["status"]): string {
  switch (status) {
    case "lead":
      return "[LEAD]";
    case "candidate":
      return "[CANDIDATE]";
    case "validated-condition":
      return "[VALIDATED]";
    case "demonstrated-impact":
      return "[IMPACT]";
    case "reportable":
      return "[REPORTABLE]";
    case "duplicate-or-known":
      return "[DUPLICATE]";
    case "rejected":
      return "[REJECTED]";
    case "unknown":
      return "[UNKNOWN]";
  }
}

function safe(value: string): string {
  return sanitizeTerminalText(value).replace(/[\r\n]/gu, " ");
}
