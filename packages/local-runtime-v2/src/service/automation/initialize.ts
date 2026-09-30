import type { AgentExtension } from '@bari/agent-runtime';
import type { AppDb } from '../../infra/db/client.js';
import { DEFAULT_BARI_AUTOMATION, type BariAutomationConfig } from '@bari/config';

import {
  createLearningPorts,
  automationConfigReader,
  type LearningRuntimeHostPort,
} from './adapter.js';
import { AutomationCoordinator } from './coordinator.js';
import { LearningAssets } from './assets.js';
import { AutomationStore } from './store.js';

export interface InitializeAutomationServiceInput {
  readonly db: AppDb;
  readonly dataDir: string;
  readonly host: LearningRuntimeHostPort;
  readonly readConfig: () => { automation?: BariAutomationConfig } | undefined;
  readonly now?: () => number;
}

export interface InitializedAutomationService {
  readonly coordinator: AutomationCoordinator;
  /** Idempotent lifecycle hook used by the runtime services lifecycle. */
  ready(): Promise<void>;
  close(): Promise<void>;
  extension(): AgentExtension;
  isActive(sessionId: string, turnId: string): boolean;
  outputTokenCap(runId: string): number | undefined;
  /** Host calls this when the user types, so pending learning yields to the user. */
  userActivity(sessionId: string): void;
  /** Host calls this after a genuine user turn settles, to admit a learning run. */
  turnCompleted(sessionId: string, turnId: string, genuinePrompt: string): void;
}

/**
 * Compose the automatic learning service.
 *
 * The store, assets and coordinator are the tested core; this function only
 * binds them to a runtime host and starts the bounded scheduler. Nothing here
 * decides whether a change is valid — that stays in the coordinator and in
 * `proposals.ts`.
 */
export function initializeAutomationService(
  input: InitializeAutomationServiceInput,
): InitializedAutomationService {
  const store = new AutomationStore(input.db, input.now);
  const assets = new LearningAssets(input.dataDir, store);
  const ports = createLearningPorts({
    host: input.host,
    assetsSnapshot: (run) => assets.snapshot(run),
    ...(input.now ? { now: input.now } : {}),
  });
  const coordinator = new AutomationCoordinator(
    store,
    assets,
    automationConfigReader(
      () => input.readConfig() ?? { automation: { ...DEFAULT_BARI_AUTOMATION } },
    ),
    ...(input.now ? [input.now] : []),
  );
  coordinator.bind(ports);
  return {
    coordinator,
    extension: () => coordinator.extension(),
    isActive: (sessionId, turnId) => coordinator.isActive(sessionId, turnId),
    outputTokenCap: (runId) => coordinator.outputTokenCap(runId),
    userActivity: (sessionId) => coordinator.userActivity(sessionId),
    turnCompleted: (sessionId, turnId, genuinePrompt) =>
      coordinator.completed(sessionId, turnId, genuinePrompt),
    ready: async () => {
      coordinator.start();
    },
    close: () => coordinator.close(),
  };
}
