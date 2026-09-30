import { describe, expect, it, vi } from 'vitest';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, AssistantMessageEventStream, Model } from '@earendil-works/pi-ai';
import {
  combinePiLLMRequestObservers,
  newPiTurnMetrics,
  observePiProviderRequests,
  type PiLLMRequestSettledInfo,
  type PiLLMRequestStartedInfo,
} from '../../../src/pi-turn-runner/metrics.js';
import { withLLMRetry } from '../../../src/pi-turn-runner/llm-retry.js';

const model = {
  id: 'fixture',
  name: 'fixture',
  provider: 'fixture',
  api: 'openai-completions',
  baseUrl: 'https://example.invalid',
  input: ['text'],
  reasoning: false,
  contextWindow: 10000,
  maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<'openai-completions'>;
const message = (): AssistantMessage => ({
  role: 'assistant',
  api: model.api,
  provider: model.provider,
  model: model.id,
  content: [{ type: 'text', text: 'private response never enters accounting' }],
  stopReason: 'stop',
  timestamp: 1,
  usage: {
    input: 10,
    output: 3,
    cacheRead: 2,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});
function stream(): AssistantMessageEventStream {
  const final = message();
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'done', reason: 'stop', message: final };
    },
    result: async () => final,
  } as AssistantMessageEventStream;
}
function observations() {
  const starts: PiLLMRequestStartedInfo[] = [],
    ends: PiLLMRequestSettledInfo[] = [];
  return {
    starts,
    ends,
    observer: (info: PiLLMRequestStartedInfo) => {
      starts.push(info);
      return (result: PiLLMRequestSettledInfo) => {
        ends.push(result);
      };
    },
  };
}

describe('physical request observer', () => {
  it('observes each retry attempt rather than only the final logical call', async () => {
    const o = observations();
    const recorder = newPiTurnMetrics(undefined, Date.now, undefined, o.observer).beginTurn(
      'chat',
      model,
      { sessionId: 'session', turnId: 'turn', logger: {} },
    );
    let attempts = 0;
    const inner: StreamFn = () => {
      if (++attempts === 1) throw Object.assign(new Error('rate limited'), { status: 429 });
      return stream();
    };
    const retry = withLLMRetry(
      recorder.wrapStreamFn(inner, { scope: 'agent', recordTerminalFailure: false }),
      {
        sessionId: 'session',
        turnId: 'turn',
        scope: 'agent',
        policy: { maxRetries: 1 },
        sleep: async () => {},
      },
    );
    const result = await retry(model, { messages: [] });
    for await (const _event of result) {
      /* consume the same stream as the agent */
    }
    await result.result();
    await recorder.settle();
    expect(o.starts).toHaveLength(2);
    expect(o.ends).toHaveLength(2);
    expect(o.ends.map((end) => end.outcome)).toEqual(['error', 'success']);
    expect(o.ends[0]?.usageStatus).toBe('missing');
    expect(o.ends[1]?.usage).toMatchObject({ totalTokens: 15 });
    expect(JSON.stringify(o)).not.toContain('private response');
  });

  it.each(['compaction', 'title'] as const)(
    'observes the auxiliary %s stream with explicit scope',
    async (scope) => {
      const o = observations();
      const wrapped = observePiProviderRequests(() => stream(), {
        sessionId: 's',
        turnId: 't',
        scope,
        observer: o.observer,
      });
      const result = await wrapped(model, { messages: [] });
      await result.result();
      await result.result();
      expect(o.starts).toMatchObject([{ sessionId: 's', turnId: 't', scope }]);
      expect(o.ends).toHaveLength(1);
    },
  );

  it('settles a thrown cancellation exactly once without inventing zero usage', async () => {
    const o = observations();
    const wrapped = observePiProviderRequests(
      () => {
        throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      },
      { sessionId: 's', turnId: 't', scope: 'compaction', observer: o.observer },
    );
    await expect(wrapped(model, { messages: [] })).rejects.toThrow('cancelled');
    expect(o.ends).toMatchObject([{ outcome: 'abort', usageStatus: 'missing', usage: {} }]);
  });

  it('settles iterator failure even if the provider result never resolves', async () => {
    const o = observations();
    const broken = {
      async *[Symbol.asyncIterator]() {
        throw new Error('iterator failed');
      },
      result: () => new Promise(() => {}),
    } as unknown as AssistantMessageEventStream;
    const wrapped = observePiProviderRequests(() => broken, {
      sessionId: 's',
      turnId: 't',
      scope: 'compaction',
      observer: o.observer,
    });
    const result = await wrapped(model, { messages: [] });
    await expect(
      (async () => {
        for await (const _event of result) {
        }
      })(),
    ).rejects.toThrow('iterator failed');
    await expect(result.result()).rejects.toThrow('iterator failed');
    expect(o.ends).toHaveLength(1);
  });

  it('does not let a broken local observer suppress Bash correlation or siblings', () => {
    const o = observations(),
      settle = vi.fn();
    const combined = combinePiLLMRequestObservers(
      () => {
        throw new Error('start');
      },
      () => () => {
        throw new Error('end');
      },
      () => settle,
      o.observer,
    );
    combined({
      sessionId: 's',
      turnId: 't',
      startedAtMs: 1,
      provider: 'p',
      model: 'm',
      caller: 'chat',
    })!({ endedAtMs: 2, cacheOutcome: 'no_read' });
    expect(settle).toHaveBeenCalledOnce();
    expect(o.ends).toHaveLength(1);
  });
});
