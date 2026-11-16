import {
  classifyLLMErrorToCode,
  toLLMProtocolClassification,
  toLLMRetryDecision,
  type NormalizedLLMError,
} from '@bari/shared/llm-error-classifier';
import type { TurnTerminationReason } from '../event-bridge/types.js';
import type { RuntimeProtocolError } from '../protocol/runtime-event.js';

/**
 * Exported alias for unit testing — the LLM-error classify branch is
 * significant enough to merit a focused regression test.
 */
export function _computeFailureTerminationReasonForTest(
  runError: string | undefined,
): TurnTerminationReason {
  return failureReason(runError);
}

export function failureReason(
  runError: string | undefined,
  normalized?: NormalizedLLMError,
): TurnTerminationReason {
  const message = runError ?? 'pi-turn-runner: unknown failure';
  const projected = normalized ? toLLMProtocolClassification(normalized) : null;
  const classified = projected
    ? { status_code: projected.code, message: projected.message ?? message }
    : classifyLLMErrorToCode(message);
  if (classified !== null) {
    const attribution = parseByokAttribution(message);
    const protocolError: RuntimeProtocolError = {
      code: classified.status_code,
      message: classified.message,
      ...(attribution ?? {}),
      ...(normalized ? { retryable: toLLMRetryDecision(normalized).retryable } : {}),
    };
    return { kind: 'failed', message: classified.message, error: protocolError };
  }
  return { kind: 'failed', message };
}

function parseByokAttribution(message: string):
  | Pick<RuntimeProtocolError, 'errorSource' | 'errorDetail' | 'errorProviderId'>
  | undefined {
  if (!message.startsWith('BYOK upstream error')) return undefined;
  const start = message.indexOf('{');
  if (start < 0) return undefined;
  try {
    const payload = JSON.parse(message.slice(start)) as Record<string, unknown>;
    const errorSource = payload.errorSource;
    const errorDetail = payload.errorDetail;
    const errorProviderId = payload.errorProviderId;
    return errorSource === 'byok_upstream' &&
      typeof errorDetail === 'string' &&
      errorDetail.trim() &&
      typeof errorProviderId === 'string' &&
      errorProviderId.trim()
      ? {
          errorSource,
          errorDetail: errorDetail.trim(),
          errorProviderId: errorProviderId.trim(),
        }
      : undefined;
  } catch {
    return undefined;
  }
}
