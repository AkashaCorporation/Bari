import { describe, expect, it, vi } from 'vitest';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { chatgptPlanPayload, withChatGPTPlanStream } from './chatgpt-plan-stream.js';

const model: Model<'openai-responses'> = {
  id: 'gpt-test',
  name: 'test',
  api: 'openai-responses',
  provider: 'openai-codex',
  baseUrl: 'https://api.openai.com/v1',
  reasoning: false,
  input: ['text'],
  contextWindow: 100_000,
  maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const message: AssistantMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'ok' }],
  api: model.api,
  provider: model.provider,
  model: model.id,
  stopReason: 'stop',
  timestamp: 0,
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

describe('ChatGPT plan Responses contract', () => {
  it('keeps full history, uses developer messages and namespaces local tools, and omits unsupported fields', () => {
    const payload = chatgptPlanPayload({
      input: [
        { type: 'message', role: 'system', content: 'instructions' },
        { role: 'user', content: 'hello' },
      ],
      tools: [{ type: 'function', name: 'read', parameters: { type: 'object' } }],
      max_output_tokens: 4000,
      temperature: 1,
      previous_response_id: 'old',
      prompt_cache_retention: '24h',
      store: true,
    });
    expect(payload).toMatchObject({
      store: false,
      stream: true,
      input: [{ role: 'developer' }, { role: 'user' }],
      tools: [{ type: 'namespace', name: 'bari', tools: [{ name: 'read' }] }],
    });
    expect(payload).not.toHaveProperty('max_output_tokens');
    expect(payload).not.toHaveProperty('temperature');
    expect(payload).not.toHaveProperty('previous_response_id');
    expect(payload).not.toHaveProperty('prompt_cache_retention');
    expect(() => chatgptPlanPayload({ input: [], tools: [{ type: 'tool_search' }] })).toThrow(
      'local function tools',
    );
  });

  it.each([true, false])(
    'requires response.completed before reporting success: %s',
    async (completed) => {
      const inner: StreamFn = (_model, _context, options) => {
        const stream = createAssistantMessageEventStream();
        if (completed) options?.onProviderStreamEvent?.({ type: 'response.completed' }, model);
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end();
        return stream;
      };
      const result = await (await withChatGPTPlanStream(inner)(model, { messages: [] })).result();
      expect(result.stopReason).toBe(completed ? 'stop' : 'error');
      if (!completed) expect(result.errorMessage).toContain('response.completed');
    },
  );

  it('does not send subscription credentials to another endpoint', async () => {
    const inner = vi.fn<StreamFn>();
    const result = await (
      await withChatGPTPlanStream(inner)(
        { ...model, baseUrl: 'https://example.invalid' },
        { messages: [] },
      )
    ).result();
    expect(result.stopReason).toBe('error');
    expect(inner).not.toHaveBeenCalled();
  });

  it('applies the plan contract after host payload hooks and preserves provider observers', async () => {
    const observer = vi.fn();
    const inner: StreamFn = (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        const payload = await options!.onPayload!({ input: [] }, model);
        expect(payload).toMatchObject({ store: false, stream: true });
        expect(payload).not.toHaveProperty('temperature');
        options!.onProviderStreamEvent!({ type: 'response.completed' }, model);
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end();
      })();
      return stream;
    };
    const result = await (
      await withChatGPTPlanStream(inner)(
        model,
        { messages: [] },
        {
          onPayload: () => ({ input: [], store: true, temperature: 2 }),
          onProviderStreamEvent: observer,
        },
      )
    ).result();
    expect(result.stopReason).toBe('stop');
    expect(observer).toHaveBeenCalledOnce();
  });
});
