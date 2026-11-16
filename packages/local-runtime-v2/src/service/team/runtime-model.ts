import type { LocalConversationRuntimeConfig } from '../model-system/index.js';
import { parseProviderId } from '../model-system/resolution/model-key.js';
import { planCustomProviderResolution } from '../model-system/resolution/model-resolver-byok.js';
import type { TeamModelRef } from './contracts.js';

/** Use the resolver's own explicit OAuth runtime-provider mapping; never infer model families. */
export function teamRuntimeProvider(config: LocalConversationRuntimeConfig, selected: TeamModelRef): string {
  const parsed = parseProviderId(selected.providerId);
  if (parsed?.source !== 'custom_provider') return selected.providerId;
  const plan = planCustomProviderResolution({ byok: config, provider: selected.providerId, providerKey: parsed.providerKey, modelId: selected.modelId });
  if (!plan) throw new Error(`Agent Teams selected provider/model is no longer configured: ${selected.providerId}/${selected.modelId}; no fallback is permitted`);
  return plan.runtimeProvider ?? selected.providerId;
}
