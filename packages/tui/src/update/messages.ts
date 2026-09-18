import { translateRuntimeText } from '@bari/shared/runtime-i18n';

export function mcodePrefixActivationScheduledMessage(
  _environment: NodeJS.ProcessEnv = process.env,
): string {
  return 'A staged Bari update will activate after this process exits.';
}

export function mcodePrefixJournalScheduleFailedMessage(
  _environment: NodeJS.ProcessEnv = process.env,
): string {
  return 'Bari update was staged, but its activation journal could not be scheduled.';
}

export function mcodePrefixNonPrefixPlanMessage(_environment: NodeJS.ProcessEnv): string {
  return 'Bari npm prefix updater received a non-prefix plan.';
}

export function mcodePrefixOwnershipMissingMessage(_environment: NodeJS.ProcessEnv): string {
  return 'Bari npm prefix ownership metadata is missing.';
}

export function mcodePrefixPendingActivationMessage(
  version: string,
  options: {
    readonly blockingSessionCount?: number;
    readonly environment?: NodeJS.ProcessEnv;
  } = {},
): string {
  if (options.blockingSessionCount === undefined) {
    return `Bari ${version} is already staged. Restarting will resume activation after running Bari sessions exit.`;
  }
  const blockingSessionCount = Math.max(0, Math.trunc(options.blockingSessionCount));
  if (blockingSessionCount > 0) {
    return `Bari ${version} is already staged. Activation will wait for ${String(blockingSessionCount)} other Bari ${blockingSessionCount === 1 ? 'session' : 'sessions'} to exit.`;
  }
  return `Bari ${version} is already staged. It will activate after this process exits.`;
}

export function mcodePrefixPendingCleanupMessage(
  version: string,
  options: {
    readonly blockingSessionCount?: number;
    readonly environment?: NodeJS.ProcessEnv;
  } = {},
): string {
  if (options.blockingSessionCount === undefined) {
    return `Bari ${version} is already active. Restarting will finish update cleanup after running Bari sessions exit.`;
  }
  const blockingSessionCount = Math.max(0, Math.trunc(options.blockingSessionCount));
  if (blockingSessionCount > 0) {
    return `Bari ${version} is already active. Update cleanup will wait for ${String(blockingSessionCount)} other Bari ${blockingSessionCount === 1 ? 'session' : 'sessions'} to exit.`;
  }
  return `Bari ${version} is already active. Restarting will finish update cleanup.`;
}

export function mcodePrefixStagedVersionMismatchMessage(
  actualVersion: string,
  expectedVersion: string,
  _environment: NodeJS.ProcessEnv,
): string {
  return `Bari update staged ${actualVersion}; expected ${expectedVersion}.`;
}

export function mcodePrefixStagedMessage(
  version: string,
  options: {
    readonly blockingSessionCount?: number;
    readonly environment?: NodeJS.ProcessEnv;
  } = {},
): string {
  if (options.blockingSessionCount === undefined) {
    return `Bari ${version} is downloaded and staged safely. Waiting for running Bari sessions to exit before activation.`;
  }
  const blockingSessionCount = Math.max(0, Math.trunc(options.blockingSessionCount));
  if (blockingSessionCount > 0) {
    return `Bari ${version} is downloaded and staged safely. Waiting for ${String(blockingSessionCount)} other Bari ${blockingSessionCount === 1 ? 'session' : 'sessions'} to exit before activation.`;
  }
  return `Bari ${version} is downloaded and staged safely. It will activate after this process exits.`;
}

export function mcodePrefixVersionedInstalledMessage(
  version: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const locale = environment.LC_ALL || environment.LC_MESSAGES || environment.LANG;
  return translateRuntimeText(locale, 'update.versionedInstalled').replace('{version}', version);
}

export function mcodePrefixNotStagedMessage(
  version: string,
  reason: string,
  _environment: NodeJS.ProcessEnv,
): string {
  return `Bari ${version} was not staged; the active installation is unchanged: ${reason}`;
}
