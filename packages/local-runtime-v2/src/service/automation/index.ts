export type { LearningRuntimeHostPort, LearningAdapterOptions } from './adapter.js';
export { createLearningPorts, automationConfigReader } from './adapter.js';
export {
  createRuntimeLearningPorts,
  type RuntimeLearningPortsInput,
  type RuntimeLearningTurnPort,
} from './runtime-learning-ports.js';
export {
  initializeAutomationService,
  type InitializeAutomationServiceInput,
  type InitializedAutomationService,
} from './initialize.js';
export { AutomationCoordinator, type AutomationPorts, type LearningContext } from './coordinator.js';
export { AutomationStore, type LearningRun } from './store.js';
export { LearningAssets } from './assets.js';
export {
  LEARNING_OUTPUT_SCHEMA,
  assetHash,
  validateLearningProposals,
  type LearningAsset,
  type LearningEvidence,
  type LearningProposal,
} from './proposals.js';
