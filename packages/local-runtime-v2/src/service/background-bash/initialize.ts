import type { BashEnvPolicy } from '@bari/agent-core/bash-subprocess-env';
import type { LocalSandboxBashOperationsFactory } from '@bari/agent-tools/desktop';

import { createLocalBackgroundBashExecutor } from './executor.js';

export function initializeLocalBackgroundBashExecutor(
  operationsFactory: LocalSandboxBashOperationsFactory,
  envPolicy: BashEnvPolicy,
) {
  return createLocalBackgroundBashExecutor(operationsFactory, envPolicy);
}
