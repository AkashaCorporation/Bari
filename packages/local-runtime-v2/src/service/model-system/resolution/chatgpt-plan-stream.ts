import {
  createAssistantMessageEventStream,
  streamSimple,
  type AssistantMessage,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { CHATGPT_PLAN_BASE_URL } from '../chatgpt-plan-auth.js';

const UNSUPPORTED_FIELDS = [
  'background',
  'conversation',
  'max_output_tokens',
  'max_tool_calls',
  'metadata',
  'moderation',
  'multi_agent',
  'prompt',
  'prompt_cache_retention',
  'safety_identifier',
  'temperature',
  'top_logprobs',
  'top_p',
  'truncation',
  'user',
  'previous_response_id',
  'service_tier',
] as const;

/** The ChatGPT plan contract is deliberately narrower than API-key Responses. */
export function chatgptPlanPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ChatGPT plan requests require a Responses payload.');
  }
  const payload = { ...value } as Record<string, unknown>;
  for (const field of UNSUPPORTED_FIELDS) delete payload[field];
  payload.store = false;
  payload.stream = true;
  if (!Array.isArray(payload.input))
    throw new Error('ChatGPT plan requests require complete input history.');
  payload.input = payload.input.map((item) => {
    if (item && typeof item === 'object' && item.role === 'system')
      return { ...item, role: 'developer' };
    if (item && typeof item === 'object' && item.type === 'function_call') {
      return { ...item, namespace: 'bari' };
    }
    return item;
  });
  if (Array.isArray(payload.tools) && payload.tools.length) {
    if (payload.tools.some((tool) => tool.type !== 'function')) {
      throw new Error('This ChatGPT connection supports Bari local function tools only.');
    }
    payload.tools = [
      {
        type: 'namespace',
        name: 'bari',
        description: 'Local Bari tools',
        tools: payload.tools,
      },
    ];
  }
  return payload;
}

export function withChatGPTPlanStream(inner: StreamFn = streamSimple): StreamFn {
  return (model, context, options) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      let completed = false;
      let terminal = false;
      let partial: AssistantMessage | undefined;
      try {
        if (
          model.api !== 'openai-responses' ||
          model.baseUrl.replace(/\/$/, '') !== CHATGPT_PLAN_BASE_URL
        ) {
          throw new Error('ChatGPT plan credentials require the public OpenAI Responses endpoint.');
        }
        const events = await inner(model, context, {
          ...options,
          onPayload: async (payload, currentModel) => {
            const updated = await options?.onPayload?.(payload, currentModel);
            return chatgptPlanPayload(updated === undefined ? payload : updated);
          },
          onProviderStreamEvent: (event, currentModel) => {
            if (
              event &&
              typeof event === 'object' &&
              'type' in event &&
              event.type === 'response.completed'
            )
              completed = true;
            options?.onProviderStreamEvent?.(event, currentModel);
          },
        });
        for await (const event of events) {
          if ('partial' in event) partial = event.partial;
          if (event.type === 'done') {
            partial = event.message;
            if (!completed)
              throw new Error('ChatGPT stream ended without response.completed. Retry the turn.');
            terminal = true;
          } else if (event.type === 'error') terminal = true;
          output.push(event);
        }
        if (!terminal) throw new Error('ChatGPT stream ended before completion. Retry the turn.');
      } catch (error) {
        const message: AssistantMessage = {
          ...(partial ?? {
            role: 'assistant',
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              reported: false,
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            timestamp: Date.now(),
          }),
          stopReason: options?.signal?.aborted ? 'aborted' : 'error',
          errorMessage: error instanceof Error ? error.message : 'ChatGPT request failed.',
        };
        output.push({
          type: 'error',
          reason: message.stopReason as 'error' | 'aborted',
          error: message,
        });
      } finally {
        output.end();
      }
    })();
    return output;
  };
}
