import type { LearningRuntimeHostPort } from './adapter.js';

/**
 * Runtime-backed {@link LearningRuntimeHostPort}.
 *
 * Bound in `services.ts` next to the Cron session ports. Everything here is a
 * thin projection of existing runtime state: this file adds no policy, and any
 * failure surfaces as a thrown error the coordinator already treats as a failed
 * or skipped run.
 */
export interface RuntimeLearningPortsInput {
  // Structural and deliberately wide: the runtime session owner exposes far
  // more than this adapter uses, and a narrow type would not bind to it.
  readonly sessions: {
    readonly repository: { get(sessionId: string): Promise<unknown> };
    readonly records: {
      createInternalSession(input: {
        agentName: string;
        workspaceDir: string;
        isDefaultWorkspace: boolean;
        sessionType: string;
        sessionKind: string;
        title: string;
        purpose: string;
        visibility: string;
      }): Promise<{ sessionId: string }>;
    };
  };  readonly messages: {
    readonly repository: {
      listRecent(
        sessionId: string,
        options: { limit: number },
      ): Promise<ReadonlyArray<Record<string, unknown>>>;
      listTurn(
        sessionId: string,
        turnId: string,
      ): Promise<ReadonlyArray<Record<string, unknown>>>;
    };
  };
  readonly resolveTurns: () => RuntimeLearningTurnPort;
  readonly modelProvider: (sessionId: string) => Promise<string | undefined>;
}

export interface RuntimeLearningTurnPort {
  steer(input: {
    sessionId: string;
    input: { text: string };
    producerId: string;
    idempotencyKey: string;
    provenance: {
      source: string;
      routingFingerprint: string;
      sourceContext?: Readonly<Record<string, unknown>>;
    };
  }): Promise<
    | { delivered: true; mode: string; turnId: string; completion?: Promise<unknown> }
    | { delivered: false; reason: string }
  >;
  readonly inspection?: {
    activeTurn(sessionId: string): Promise<unknown>;
  };
}

export function createRuntimeLearningPorts(
  input: RuntimeLearningPortsInput,
): LearningRuntimeHostPort {
  // `steer` settles an activated Turn through a completion promise; holding it
  // per turn is what lets `waitForTurn` actually wait instead of guessing.
  const completions = new Map<string, Promise<unknown>>();
  // The turn owner is created after this service, so it is resolved per call.
  const turns = (): RuntimeLearningTurnPort => input.resolveTurns();
  return {
    async getSession(sessionId) {
      const record = (await input.sessions.repository.get(sessionId)) as
        | {
            agentName?: string;
            workspaceDir?: string;
            archived?: boolean;
          }
        | undefined;
      if (!record || record.archived) return undefined;
      const agentName = text(record.agentName);
      const workspaceDir = text(record.workspaceDir);
      if (!agentName || !workspaceDir) return undefined;
      return { agentName, workspaceDir };
    },

    async isBusy(sessionId) {
      const active = await turns().inspection?.activeTurn(sessionId);
      return Boolean(active);
    },

    async readEvidence(sessionId, limit) {
      const rows = await input.messages.repository.listRecent(sessionId, { limit });
      const evidence: Array<{ messageId: string; role: string; text: string }> = [];
      for (const row of rows) {
        const role = text(row.role);
        // Tool output, system reminders and system rows are not user evidence.
        if (role !== 'user' && role !== 'assistant') continue;
        const body = messageText(row);
        if (!body) continue;
        const messageId = text(row.canonical_message_id) ?? text(row.msg_id);
        if (!messageId) continue;
        evidence.push({ messageId, role, text: body });
      }
      return evidence;
    },

    async resolveModelProvider(sessionId) {
      return input.modelProvider(sessionId);
    },

    async createChildSession({ agentName, workspaceDir, title }) {
      const created = await input.sessions.records.createInternalSession({
        agentName,
        workspaceDir,
        isDefaultWorkspace: false,
        sessionType: 'branch',
        sessionKind: 'task',
        title,
        purpose: title,
        visibility: 'visible',
      });
      return created.sessionId;
    },

    async deliverTurn({ sessionId, runId, text }) {
      const result = await turns().steer({
        sessionId,
        input: { text },
        producerId: `learning:${runId}`,
        idempotencyKey: `learning:${runId}`,
        provenance: {
          source: 'learning',
          routingFingerprint: `learning:${runId}`,
          sourceContext: { learning: { runId } },
        },
      });
      if (!result.delivered) return undefined;
      if (result.completion) completions.set(result.turnId, result.completion);
      return { turnId: result.turnId };
    },

    async waitForTurn(sessionId, turnId) {
      const completion = completions.get(turnId);
      if (completion) {
        await completion;
        completions.delete(turnId);
        return;
      }
      // A steered (non-activated) Turn was already delivered inline; the
      // assistant row is committed by the time `steer` resolves.
      const rows = await input.messages.repository.listTurn(sessionId, turnId);
      if (!rows.length) {
        throw new Error('learning_turn_not_committed');
      }
    },

    async readAssistantText(sessionId, turnId) {
      const rows = await input.messages.repository.listTurn(sessionId, turnId);
      for (const row of rows) {
        if (text(row.role) !== 'assistant') continue;
        const body = messageText(row);
        if (body) return body;
      }
      return undefined;
    },

    async readTurnUserPrompt(sessionId, turnId) {
      const rows = await input.messages.repository.listTurn(sessionId, turnId);
      for (const row of rows) {
        if (text(row.role) !== 'user') continue;
        const body = messageText(row);
        if (body) return body;
      }
      return undefined;
    },
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Mirrors the legacy migration reader: content may be a string or a block array. */
function messageText(row: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of ['msg_content', 'content', 'text'] as const) {
    const value = blockText(row[key]);
    if (value) return value;
  }
  return undefined;
}

function blockText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const block of value) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (typeof record.text === 'string') parts.push(record.text);
  }
  const joined = parts.join('\n').trim();
  return joined || undefined;
}
