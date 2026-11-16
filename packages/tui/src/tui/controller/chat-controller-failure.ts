import type { TuiSession } from '../../runtime/port.js';
import type { TuiStreamEvent } from '../../runtime/stream-events.js';
import { resolveTuiRuntimeFailure } from './runtime/runtime-error-presentation.js';

export interface TuiSessionFailureState {
  readonly status: 'idle' | 'error';
  readonly error: string | undefined;
  readonly errorRetryable: boolean | undefined;
}

export function resolveTuiSessionFailureState(
  session: TuiSession | undefined,
): TuiSessionFailureState {
  const failure =
    session?.status === 'error'
      ? resolveTuiRuntimeFailure(session.errorMessage, session.errorCode, {
          errorSource: session.errorSource,
          errorDetail: session.errorDetail,
          errorProviderId: session.errorProviderId,
        })
      : undefined;
  return {
    status: failure ? 'error' : 'idle',
    error: failure?.content,
    errorRetryable: failure?.retryable,
  };
}

export function isTuiStreamFailureRetryable(event: TuiStreamEvent): boolean {
  if (event.type === 'error' || (event.type === 'session-status' && event.status === 'error')) {
    return resolveTuiRuntimeFailure(event.message, event.errorCode, {
      retryable: event.retryable,
      errorSource: event.errorSource,
      errorDetail: event.errorDetail,
      errorProviderId: event.errorProviderId,
    }).retryable;
  }
  return resolveTuiRuntimeFailure(undefined).retryable;
}
