import type { TuiModel } from '../../../types/runtime-models.js';

/**
 * Zero-cost ("free") detection for model lists.
 *
 * Gateways such as OpenCode Go mark zero-cost models with a `-free` id suffix
 * (e.g. `space-bunny-free`, `longcat-2.5-preview-free`), and the models.dev
 * catalog agrees: those ids carry `cost.input`/`cost.output` of 0 while every
 * other model on the gateway is billed. The suffix convention therefore tracks
 * the published pricing without a network lookup.
 *
 * A provider that does not follow the convention can still opt in through the
 * explicit `free` flag on the model entry.
 */
export function isFreeModelId(modelId: string): boolean {
  return /-free$/i.test(modelId.trim());
}

export function isFreeTuiModel(model: TuiModel): boolean {
  return model.free ?? isFreeModelId(model.modelId);
}

/** Badge text for zero-cost models; `undefined` for everything else. */
export function freeModelTag(model: TuiModel): string | undefined {
  return isFreeTuiModel(model) ? 'free' : undefined;
}
