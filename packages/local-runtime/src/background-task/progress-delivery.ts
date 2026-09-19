import {
  ConversationTurnRejectedError,
  type ConversationSteerInput,
} from '@bari/conversation-contract';

import { makeId } from '../api/host-helpers.js';
import { observeSteerCompletion } from '../api/conversation-steer.js';
import {
  requireTaskConversation,
  type LocalTaskRunnerHostWithSessionLookup,
} from '../api/local-task-host.js';
import { isLocalChildWorkerSession } from '../sessions/session-policy.js';
import { isTerminalTaskStatus, type BackgroundTask } from './domain.js';

const PROGRESS_ENV_KEYS = [
  'BARI_TASK_PROGRESS_INTERVAL_MS',
  'MAVIS_TASK_PROGRESS_INTERVAL_MS',
] as const;
const DEFAULT_PROGRESS_INTERVAL_MS = 240_000;
const MIN_PROGRESS_INTERVAL_MS = 30_000;
const MAX_PROGRESS_INTERVAL_MS = 3_600_000;
const STALL_INTERVAL_FACTOR = 2;

const heartbeats = new WeakMap<
  LocalTaskRunnerHostWithSessionLookup,
  Map<string, ReturnType<typeof setInterval>>
>();

/**
 * Resolves the progress-notice interval. `0` disables the heartbeat; unset uses
 * four minutes; values are clamped so a bad environment value cannot turn the
 * heartbeat into a polling storm.
 */
export function resolveTaskProgressIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  for (const key of PROGRESS_ENV_KEYS) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    if (parsed === 0) return undefined;
    return Math.min(Math.max(Math.trunc(parsed), MIN_PROGRESS_INTERVAL_MS), MAX_PROGRESS_INTERVAL_MS);
  }
  return DEFAULT_PROGRESS_INTERVAL_MS;
}

/**
 * Wakes the owning conversation periodically while a background task runs, so
 * the parent can report progress instead of waiting blind until the finish
 * event. The heartbeat never stops the task and clears itself on any terminal
 * status.
 */
export function startLocalBackgroundTaskProgressHeartbeat(
  host: LocalTaskRunnerHostWithSessionLookup,
  taskId: string,
): void {
  const intervalMs = resolveTaskProgressIntervalMs();
  if (!intervalMs) return;
  let perHost = heartbeats.get(host);
  if (!perHost) {
    perHost = new Map();
    heartbeats.set(host, perHost);
  }
  if (perHost.has(taskId)) return;
  const timer = setInterval(() => {
    void tick(host, taskId, intervalMs, perHost);
  }, intervalMs);
  timer.unref?.();
  perHost.set(taskId, timer);
}

async function tick(
  host: LocalTaskRunnerHostWithSessionLookup,
  taskId: string,
  intervalMs: number,
  perHost: Map<string, ReturnType<typeof setInterval>>,
): Promise<void> {
  try {
    const task = await host.backgroundTaskService.get(taskId);
    if (!task || isTerminalTaskStatus(task.status)) {
      stopHeartbeat(perHost, taskId);
      return;
    }
    const session = await host.getSessionById(task.ownerSessionId);
    if (!session || isLocalChildWorkerSession(session)) return;
    const nowMs = host.nowMs();
    const elapsedMs = Math.max(0, nowMs - (task.startedAt ?? task.createdAt));
    const lastActivityMs = Math.max(0, nowMs - task.updatedAt);
    await startConversationBackgroundTaskProgressTurn({
      host,
      task,
      elapsedMs,
      lastActivityMs,
      stalled: lastActivityMs >= intervalMs * STALL_INTERVAL_FACTOR,
    });
  } catch {
    // A failed or busy notice must not stop the heartbeat; the next tick retries.
  }
}

function stopHeartbeat(
  perHost: Map<string, ReturnType<typeof setInterval>>,
  taskId: string,
): void {
  const timer = perHost.get(taskId);
  if (timer) clearInterval(timer);
  perHost.delete(taskId);
}

async function startConversationBackgroundTaskProgressTurn(input: {
  host: LocalTaskRunnerHostWithSessionLookup;
  task: BackgroundTask;
  elapsedMs: number;
  lastActivityMs: number;
  stalled: boolean;
}): Promise<'delivered' | 'busy' | 'failed'> {
  const { host, task } = input;
  try {
    const requestedTurnId = makeId('turn_task_progress');
    const steered = await requireTaskConversation(host).ingress.steer(
      buildBackgroundTaskProgressInput({
        task,
        elapsedMs: input.elapsedMs,
        lastActivityMs: input.lastActivityMs,
        stalled: input.stalled,
        requestedTurnId,
      }),
    );
    observeSteerCompletion(steered, {
      sessionId: task.ownerSessionId,
      producer: 'Local background task progress',
      ...(host.matrixLogger ? { matrixLogger: host.matrixLogger } : {}),
    });
    return 'delivered';
  } catch (error) {
    if (error instanceof ConversationTurnRejectedError) return 'busy';
    return 'failed';
  }
}

export function buildBackgroundTaskProgressInput(input: {
  task: BackgroundTask;
  elapsedMs: number;
  lastActivityMs: number;
  stalled: boolean;
  requestedTurnId: string;
}): ConversationSteerInput {
  return {
    sessionId: input.task.ownerSessionId,
    source: 'background-task',
    requestedTurnId: input.requestedTurnId,
    producerId: 'background-task-progress',
    idempotencyKey: `background-task-progress:${input.task.taskId}:${Math.floor(input.elapsedMs / 60_000)}`,
    message: {
      content: buildBackgroundTaskProgressPrompt(input),
      attachments: [],
      hideUserMessage: true,
      origin: {
        kind: 'background-task-progress',
        taskIds: [input.task.taskId],
        observedTerminalCount: 0,
      },
    },
  };
}

export function buildBackgroundTaskProgressPrompt(input: {
  task: BackgroundTask;
  elapsedMs: number;
  lastActivityMs: number;
  stalled: boolean;
}): string {
  const { task } = input;
  const description = task.description
    ? ` description="${escapeXmlAttribute(task.description)}"`
    : '';
  return [
    '<background-task-progress>',
    'A local background task is still running in this conversation.',
    `  <task task_id="${escapeXmlAttribute(task.taskId)}" status="${task.status}"${description} elapsed_ms="${input.elapsedMs}" last_activity_ms="${input.lastActivityMs}" stalled="${input.stalled}"/>`,
    ...(input.stalled
      ? [
          'No new output was observed for a while. Report the stall to the user and ask before stopping the task.',
        ]
      : []),
    'Read task_output for a progress snapshot and report a brief progress note to the user.',
    'This is not completion: never stop or time out a healthy task, and do not report the task as finished.',
    'Do not mention this internal notice unless it is necessary to explain the progress.',
    '</background-task-progress>',
  ].join('\n');
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
