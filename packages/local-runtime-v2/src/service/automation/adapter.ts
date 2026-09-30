import { assetHash, type LearningEvidence } from './proposals.js';
import type { AutomationPorts, LearningContext } from './coordinator.js';
import type { LearningRun } from './store.js';
import { DEFAULT_BARI_AUTOMATION, type BariAutomationConfig } from '@bari/config';

/**
 * Session-side surface the automatic learning adapter needs from the runtime.
 *
 * Declared here and bound in composition (like the Cron session ports) so the
 * coordinator stays free of product imports and the capture policy stays
 * testable without a live runtime.
 */
export interface LearningRuntimeHostPort {
  /** Resolve a live, unarchived session; `undefined` when it is gone. */
  getSession(
    sessionId: string,
  ): Promise<{ agentName: string; workspaceDir: string } | undefined>;
  /** True while the session owns an in-flight turn. */
  isBusy(sessionId: string): Promise<boolean>;
  /**
   * Recent user/assistant text, oldest first. The adapter keeps only user and
   * assistant rows: tool output and system rows are not learning evidence.
   */
  readEvidence(
    sessionId: string,
    limit: number,
  ): Promise<Array<{ messageId: string; role: string; text: string }>>;
  /** Model provider string the child request must stay on. */
  resolveModelProvider(sessionId: string): Promise<string | undefined>;  /** Create the visible `learning:` child session for one maintenance run. */
  createChildSession(input: {
    agentName: string;
    workspaceDir: string;
    title: string;
    runId: string;
  }): Promise<string>;
  /**
   * Deliver exactly one Turn to the child and resolve with its turn id. The
   * caller awaits {@link LearningRuntimeHostPort.waitForTurn} separately so the
   * deadline and cancellation stay with the coordinator.
   */
  deliverTurn(input: {
    sessionId: string;
    runId: string;
    text: string;
  }): Promise<{ turnId: string } | undefined>;
  /** Wait for the child Turn to settle. */
  waitForTurn(
    sessionId: string,
    turnId: string,
  ): Promise<void>;
  /** Read back the assistant reply text for that Turn. */
  readAssistantText(sessionId: string, turnId: string): Promise<string | undefined>;
  /** First user message of a Turn; gates learning admission to genuine turns. */
  readTurnUserPrompt(sessionId: string, turnId: string): Promise<string | undefined>;
}

export interface LearningAdapterOptions {
  readonly host: LearningRuntimeHostPort;
  readonly assetsSnapshot: (run: LearningRun) => LearningContext['assets'];
  readonly maxEvidenceMessages?: number;
  readonly now?: () => number;
}

const DEFAULT_EVIDENCE_MESSAGES = 40;
const CHILD_TITLE_PREFIX = 'learning:';

/**
 * Production {@link AutomationPorts} for the learning coordinator.
 *
 * The adapter owns no authority. Every guard that decides whether a run may
 * proceed lives in the coordinator; this file only reads state, asks the host
 * for one child Turn, and hands back whatever text came out.
 */
export function createLearningPorts(options: LearningAdapterOptions): AutomationPorts {
  const { host } = options;
  const limit = options.maxEvidenceMessages ?? DEFAULT_EVIDENCE_MESSAGES;
  return {
    async describe(sessionId) {
      const session = await host.getSession(sessionId);
      if (!session) {
        return { agentName: '', workspaceDir: '', eligible: false };
      }
      return {
        agentName: session.agentName,
        workspaceDir: session.workspaceDir,
        eligible: true,
      };
    },
    busy: (sessionId) => host.isBusy(sessionId),
    async capture(run, _config) {
      const parent = await host.getSession(run.parentSessionId);
      if (!parent) throw new Error('parent_session_missing');
      const rows = await host.readEvidence(run.parentSessionId, limit);
      const assistantMessages = rows.filter((row) => row.role === 'assistant').length;
      const evidence: LearningEvidence[] = rows.map((row) => ({
        id: row.messageId,
        messageId: row.messageId,
        role: row.role,
        text: row.text,
        hash: assetHash(row.text),
      }));
      const assets = options.assetsSnapshot(run);
      return {
        evidence,
        assets,
        // Learned skills are exactly the `skill` assets this identity already
        // owns, so the model is told what exists without a second skill lookup.
        existingSkillNames: assets
          .filter((asset) => asset.kind === 'skill')
          .map((asset) => asset.target),
        assistantMessages,
        // Host-owned maintenance has no product system prompt of its own; the
        // envelope in the coordinator is the whole instruction surface.
        systemPrompt: '',
        modelProvider: (await host.resolveModelProvider(run.parentSessionId)) ?? '',
      };
    },
    async execute(run, _context, input) {
      const parent = await host.getSession(run.parentSessionId);
      if (!parent) throw new Error('parent_session_missing');
      const childSessionId = await host.createChildSession({
        agentName: parent.agentName,
        workspaceDir: parent.workspaceDir,
        title: `${CHILD_TITLE_PREFIX}${run.runId}`,
        runId: run.runId,
      });
      const delivered = await host.deliverTurn({
        sessionId: childSessionId,
        runId: run.runId,
        text: input.text,
      });
      if (!delivered) throw new Error('learning_turn_not_admitted');
      input.onChild(childSessionId, delivered.turnId);
      const abort = () => {
        /* host honours cancellation through the coordinator signal */
      };
      if (input.signal.aborted) {
        abort();
        throw new Error('learning_turn_aborted');
      }
      input.signal.addEventListener('abort', abort, { once: true });
      try {
        await host.waitForTurn(childSessionId, delivered.turnId);
      } finally {
        input.signal.removeEventListener('abort', abort);
      }
      const text = await host.readAssistantText(childSessionId, delivered.turnId);
      if (text === undefined) throw new Error('learning_turn_empty');
      return text;
    },
  };
}

/** Config accessor used by the coordinator; kept here so binding stays in one file. */
export function automationConfigReader(
  read: () => { automation?: BariAutomationConfig } | undefined,
): () => BariAutomationConfig {
  return () => read()?.automation ?? { ...DEFAULT_BARI_AUTOMATION };
}
