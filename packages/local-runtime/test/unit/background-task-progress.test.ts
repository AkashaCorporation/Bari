import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BackgroundTask } from '../../src/background-task/domain.js';
import {
  buildBackgroundTaskProgressPrompt,
  resolveTaskProgressIntervalMs,
  startLocalBackgroundTaskProgressHeartbeat,
} from '../../src/background-task/progress-delivery.js';
import type { LocalTaskRunnerHostWithSessionLookup } from '../../src/api/local-task-host.js';

const runningTask = {
  taskId: 'task-1',
  kind: 'subagent',
  status: 'running',
  ownerSessionId: 'session-1',
  description: 'resolver <CTF> "Poly"',
  createdAt: 1_000,
  updatedAt: 2_000,
  startedAt: 1_500,
} as BackgroundTask;

describe('background task progress notices', () => {
  it('builds a progress prompt with elapsed time, activity, and stall state', () => {
    const text = buildBackgroundTaskProgressPrompt({
      task: runningTask,
      elapsedMs: 600_000,
      lastActivityMs: 500_000,
      stalled: true,
    });

    expect(text).toContain('<background-task-progress>');
    expect(text).toContain('task_id="task-1"');
    expect(text).toContain('status="running"');
    expect(text).toContain('elapsed_ms="600000"');
    expect(text).toContain('last_activity_ms="500000"');
    expect(text).toContain('stalled="true"');
    expect(text).toContain('&lt;CTF&gt;');
    expect(text).toContain('&quot;Poly&quot;');
    expect(text).toContain('not completion');
    expect(text).toContain('ask before stopping the task');
  });

  it('omits the stall instruction while the task is producing output', () => {
    const text = buildBackgroundTaskProgressPrompt({
      task: runningTask,
      elapsedMs: 120_000,
      lastActivityMs: 1_000,
      stalled: false,
    });

    expect(text).toContain('stalled="false"');
    expect(text).not.toContain('ask before stopping the task');
  });

  it('resolves the interval from the environment with bounds and disable support', () => {
    expect(resolveTaskProgressIntervalMs({})).toBe(240_000);
    expect(resolveTaskProgressIntervalMs({ BARI_TASK_PROGRESS_INTERVAL_MS: '60000' })).toBe(60_000);
    expect(resolveTaskProgressIntervalMs({ BARI_TASK_PROGRESS_INTERVAL_MS: '1' })).toBe(30_000);
    expect(resolveTaskProgressIntervalMs({ BARI_TASK_PROGRESS_INTERVAL_MS: '99999999' })).toBe(
      3_600_000,
    );
    expect(resolveTaskProgressIntervalMs({ BARI_TASK_PROGRESS_INTERVAL_MS: '0' })).toBeUndefined();
    expect(resolveTaskProgressIntervalMs({ MAVIS_TASK_PROGRESS_INTERVAL_MS: '120000' })).toBe(
      120_000,
    );
  });
});

describe('background task progress heartbeat', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('steers progress notices while running and stops on terminal status', async () => {
    vi.useFakeTimers();
    const running = {
      ...runningTask,
      createdAt: Date.now(),
      startedAt: Date.now(),
      updatedAt: Date.now(),
    } as BackgroundTask;
    const tasks = new Map<string, BackgroundTask>([['task-1', running]]);
    const steer = vi.fn(async () => ({ accepted: true }));
    const host = {
      backgroundTaskService: { get: async (taskId: string) => tasks.get(taskId) },
      getSessionById: async (sessionId: string) => ({ sessionId }) as never,
      nowMs: () => Date.now(),
      runtimeConversation: { ingress: { steer } },
    } as unknown as LocalTaskRunnerHostWithSessionLookup;

    startLocalBackgroundTaskProgressHeartbeat(host, 'task-1');
    await vi.advanceTimersByTimeAsync(240_000);
    expect(steer).toHaveBeenCalledTimes(1);
    expect(String(steer.mock.calls[0]?.[0]?.message?.content ?? '')).toContain(
      '<background-task-progress>',
    );

    tasks.set('task-1', { ...running, status: 'succeeded' } as BackgroundTask);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(steer).toHaveBeenCalledTimes(1);
  });
});
