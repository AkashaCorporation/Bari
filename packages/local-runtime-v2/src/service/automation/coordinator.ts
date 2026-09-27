import type { BariAutomationConfig } from "@bari/config";
import type { AgentExtension } from "@bari/agent-runtime";
import { learningWorkspaceKey } from "@bari/shared/automation-assets";
import { AutomationStore, type LearningRun } from "./store.js";
import { LearningAssets } from "./assets.js";
import {
  LEARNING_OUTPUT_SCHEMA,
  validateLearningProposals,
  type LearningAsset,
  type LearningEvidence,
} from "./proposals.js";

export interface LearningContext {
  evidence: LearningEvidence[];
  assets: LearningAsset[];
  existingSkillNames: string[];
  assistantMessages: number;
  systemPrompt: string;
  modelProvider: string;
}
export interface AutomationPorts {
  describe(
    sessionId: string,
  ): Promise<{ agentName: string; workspaceDir: string; eligible: boolean }>;
  busy(sessionId: string): Promise<boolean>;
  capture(
    run: LearningRun,
    config: BariAutomationConfig,
  ): Promise<LearningContext>;
  execute(
    run: LearningRun,
    context: LearningContext,
    input: {
      text: string;
      schema: typeof LEARNING_OUTPUT_SCHEMA;
      signal: AbortSignal;
      deadline: number;
      onChild(sessionId: string, turnId: string): void;
    },
  ): Promise<string>;
  changed?(run: LearningRun): Promise<void>;
}
interface ActiveLearning {
  run: LearningRun;
  controller: AbortController;
  config: BariAutomationConfig;
  childSessionId?: string;
  childTurnId?: string;
  calls: number;
  provider: string;
}

/** One bounded job at a time, with a durable cross-process lease and parent-generation fence. */
export class AutomationCoordinator {
  private ports?: AutomationPorts;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private ticking = false;
  private active?: ActiveLearning;
  private running?: Promise<void>;
  private readonly admissions = new Set<Promise<void>>();
  constructor(
    readonly store: AutomationStore,
    readonly assets: LearningAssets,
    private readonly config: () => BariAutomationConfig,
    private readonly now = Date.now,
  ) {}

  bind(ports: AutomationPorts): void {
    this.ports = ports;
  }
  start(): void {
    if (this.timer || this.closed) return;
    this.assets.recoverIntents();
    this.timer = setInterval(() => {
      void this.tick().catch(() => {});
    }, 1000);
    this.timer.unref?.();
  }
  userActivity(sessionId: string): void {
    if (this.closed) return;
    this.store.userActivity(sessionId);
    if (this.active?.run.parentSessionId === sessionId)
      this.active.controller.abort(new Error("User work has priority"));
  }
  completed(sessionId: string, turnId: string, genuinePrompt: string): void {
    if (this.closed || !genuinePrompt.trim() || !this.ports) return;
    const pending = this.admit(sessionId, turnId)
      .catch(() => {})
      .finally(() => this.admissions.delete(pending));
    this.admissions.add(pending);
  }
  private async admit(sessionId: string, turnId: string): Promise<void> {
    const config = this.config();
    if (!config.enabled || (!config.dream && !config.distill)) return;
    const generation = this.store.generation(sessionId);
    const parent = await this.ports!.describe(sessionId);
    if (
      this.closed ||
      !parent.eligible ||
      generation !== this.store.generation(sessionId)
    )
      return;
    const workspaceKey = learningWorkspaceKey(parent.workspaceDir);
    this.store.enqueue({
      parentSessionId: sessionId,
      sourceTurnId: turnId,
      agentName: parent.agentName,
      workspaceDir: parent.workspaceDir,
      workspaceKey,
      groupKey: `${workspaceKey}:${parent.agentName}`,
    });
  }
  async tick(): Promise<void> {
    if (this.closed || !this.ports) return;
    const config = this.config();
    if (!config.enabled || (!config.dream && !config.distill)) {
      this.active?.controller.abort(new Error("Automatic learning disabled"));
      for (const run of this.store.pending())
        this.store.finish(run.runId, "cancelled", "disabled");
      return;
    }
    if (this.active || this.ticking) return;
    this.ticking = true;
    try {
      for (const run of this.store.pending()) {
        if (
          this.now() - run.createdAtMs < config.idleDelayMs ||
          (await this.ports.busy(run.parentSessionId))
        )
          continue;
        const parent = await this.ports.describe(run.parentSessionId);
        if (
          !parent.eligible ||
          learningWorkspaceKey(parent.workspaceDir) !== run.workspaceKey
        ) {
          this.store.finish(run.runId, "skipped", "parent_unavailable");
          continue;
        }
        let context: LearningContext;
        try {
          context = await this.ports.capture(run, config);
        } catch {
          this.store.finish(run.runId, "skipped", "context_unavailable");
          continue;
        }
        if (
          context.assistantMessages < config.minAssistantMessages ||
          !context.evidence.length
        ) {
          this.store.finish(run.runId, "skipped", "insufficient_evidence");
          continue;
        }
        if (!this.store.claim(run, config)) continue;
        const active: ActiveLearning = {
          run,
          controller: new AbortController(),
          config,
          calls: 0,
          provider: context.modelProvider,
        };
        this.active = active;
        this.running = this.run(active, context).finally(() => {
          if (this.active === active) this.active = undefined;
        });
        await this.running;
        break;
      }
    } finally {
      this.ticking = false;
    }
  }
  private async run(
    active: ActiveLearning,
    context: LearningContext,
  ): Promise<void> {
    const { run, config, controller } = active;
    const timer = setTimeout(
      () => controller.abort(new Error("Automatic learning deadline")),
      config.timeoutMs,
    );
    timer.unref?.();
    try {
      this.store.report(run.runId, {
        sources: context.evidence.map((e) => ({
          id: e.id,
          messageId: e.messageId,
          hash: e.hash,
        })),
      });
      const envelope = JSON.stringify({
        task: "Consolidate durable memory and distill genuinely repeated workflows. Return changes: [] when evidence is insufficient.",
        enabled: { dream: config.dream, distill: config.distill },
        existingSkillNames: context.existingSkillNames,
        assets: context.assets.map((asset) => ({
          kind: asset.kind,
          target: asset.target,
          text: asset.text,
        })),
        evidence: context.evidence,
      });
      if (Buffer.byteLength(envelope) > config.maxEvidenceBytes)
        throw new Error("evidence_budget");
      const text = await this.ports!.execute(run, context, {
        text: envelope,
        schema: LEARNING_OUTPUT_SCHEMA,
        signal: controller.signal,
        deadline: this.now() + config.timeoutMs,
        onChild: (sessionId, turnId) => {
          active.childSessionId = sessionId;
          active.childTurnId = turnId;
          this.store.bindChild(run.runId, sessionId, turnId);
        },
      });
      const allowed = () =>
        !this.closed &&
        !controller.signal.aborted &&
        this.config().enabled &&
        this.store.valid(run);
      if (
        !allowed() ||
        !(await this.ports!.describe(run.parentSessionId)).eligible
      )
        throw new Error("stale_parent");
      if (Buffer.byteLength(text) > 24 * 1024)
        throw new Error("proposal_budget");
      const current = this.config();
      const changes = validateLearningProposals(JSON.parse(text), {
        ...context,
        dream: current.dream,
        distill: current.distill,
      });
      for (const change of changes) {
        await this.assets.apply(
          run,
          change,
          () =>
            allowed() &&
            (change.before.kind === "memory"
              ? this.config().dream
              : this.config().distill),
        );
      }
      this.store.finish(
        run.runId,
        changes.length ? "applied" : "no_op",
        undefined,
        {
          changes: changes.map((change) => ({
            kind: change.before.kind,
            target: change.before.target,
          })),
          sources: context.evidence.map((e) => ({
            id: e.id,
            messageId: e.messageId,
            hash: e.hash,
          })),
        },
      );
      if (changes.length) await this.ports!.changed?.(run);
      this.store.pruneBeforeImages();
    } catch {
      const applied = this.store
        .journal(run.runId)
        .filter((change) => change.state === "applied").length;
      this.store.finish(
        run.runId,
        applied
          ? "partially_applied"
          : controller.signal.aborted || this.closed
            ? "cancelled"
            : "failed",
        controller.signal.aborted
          ? "interrupted"
          : "validation_or_execution_failed",
        { applied },
      );
    } finally {
      clearTimeout(timer);
    }
  }
  isActive(sessionId: string, turnId: string): boolean {
    return (
      this.active?.childSessionId === sessionId &&
      this.active?.childTurnId === turnId &&
      !this.active.controller.signal.aborted
    );
  }
  outputTokenCap(runId: string): number | undefined {
    return this.active?.run.runId === runId
      ? this.active.config.maxOutputTokens
      : undefined;
  }
  extension(): AgentExtension {
    return {
      id: "bari-learning-budget",
      description: "Bounds host-owned automatic learning requests.",
      init: (api) => {
        api.on("before_llm_call", (input, turn) => {
          if (turn.turnIntent?.kind !== "learning-maintenance") return;
          const active = this.active;
          if (
            !active ||
            !this.isActive(turn.sessionId, turn.turnId) ||
            !this.store.valid(active.run) ||
            !this.config().enabled ||
            active.calls >= 1 ||
            input.model.provider !== active.provider ||
            Buffer.byteLength(
              JSON.stringify({
                messages: input.messages,
                systemPrompt: input.systemPrompt,
                tools: input.tools,
              }),
            ) >
              active.config.maxEvidenceBytes + 20_000
          ) {
            return {
              type: "abort",
              reason: "Automatic learning exceeded its host-owned boundary.",
            };
          }
          active.calls++;
        });
        api.on("before_tool_call", (_input, _signal, turn) =>
          turn.turnIntent?.kind === "learning-maintenance"
            ? {
                block: true,
                reason:
                  "Automatic learning returns proposals only; tools are unavailable.",
              }
            : undefined,
        );
      },
    };
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.active?.controller.abort(new Error("Runtime shutdown"));
    await Promise.allSettled([
      ...this.admissions,
      ...(this.running ? [this.running] : []),
    ]);
  }
}
