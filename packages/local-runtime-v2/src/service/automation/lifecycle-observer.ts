import {
  RuntimeEventStatus,
  RuntimeEventType,
  type RuntimeEvent,
} from '@bari/agent-core/protocol';

/**
 * Turn ingresses that are host-owned, not user work.
 *
 * Their turns must not count as "the user came back" and must not admit a
 * learning run, otherwise maintenance would keep feeding itself.
 */
const HOST_OWNED_SOURCES = new Set(['learning', 'cron', 'background-task']);

export interface LearningLifecycleObserverInput {
  /** A turn is starting: the user is working, so yield to them. */
  readonly onUserActivity: (sessionId: string) => void;
  /** A genuine user turn settled: consider admitting a learning run. */
  readonly onTurnCompleted: (
    sessionId: string,
    turnId: string,
    genuinePrompt: string,
  ) => void;
  /** First user message of a turn, used as the genuine-prompt gate. */
  readonly readTurnUserPrompt: (
    sessionId: string,
    turnId: string,
  ) => Promise<string | undefined>;
}

/**
 * Binds the learning coordinator to the Turn lifecycle.
 *
 * A starting turn is user work: it invalidates pending learning and interrupts
 * an active run. A terminal turn is the admission point — but only when the
 * turn actually carried a user prompt, which is how the coordinator rejects
 * synthetic, resumed and host-owned turns.
 *
 * Everything here is best-effort. Learning must never be able to fail a Turn.
 */
export class LearningLifecycleObserver {
  constructor(private readonly input: LearningLifecycleObserverInput) {}

  observe(input: {
    readonly context: {
      readonly sessionId: string;
      readonly turnId: string;
      readonly provenance?: { readonly source?: string };
    };
    readonly event: RuntimeEvent;
  }): void {
    const { context, event } = input;
    if (HOST_OWNED_SOURCES.has(context.provenance?.source ?? '')) return;
    const status = lifecycleStatus(event);
    if (status === 'running') {
      this.input.onUserActivity(context.sessionId);
      return;
    }
    if (!status) return;
    void this.admit(context);
  }

  private async admit(context: {
    readonly sessionId: string;
    readonly turnId: string;
  }): Promise<void> {
    try {
      const prompt = await this.input.readTurnUserPrompt(
        context.sessionId,
        context.turnId,
      );
      if (!prompt) return;
      this.input.onTurnCompleted(context.sessionId, context.turnId, prompt);
    } catch {
      // Admission is best-effort: a failed capture must not surface to the user.
    }
  }
}

type LifecycleStatus = 'running' | 'terminal' | undefined;

function lifecycleStatus(event: RuntimeEvent): LifecycleStatus {
  if (
    event.type !== RuntimeEventType.SESSION_STATUS &&
    event.type !== RuntimeEventType.TURN_TERMINAL
  ) {
    return undefined;
  }
  if (event.payload.status === RuntimeEventStatus.RUNNING) return 'running';
  return event.payload.status === RuntimeEventStatus.COMPLETED ||
    event.payload.status === RuntimeEventStatus.FAILED ||
    event.payload.status === RuntimeEventStatus.ABORTED
    ? 'terminal'
    : undefined;
}
