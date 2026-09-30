import { describe, expect, it } from "vitest";
import {
  freeModelTag,
  isFreeModelId,
  isFreeTuiModel,
} from "../../src/tui/features/model/pricing.js";

describe("model pricing tags", () => {
  it("detects the -free id convention used by zero-cost gateway models", () => {
    expect(isFreeModelId("space-bunny-free")).toBe(true);
    expect(isFreeModelId("longcat-2.5-preview-free")).toBe(true);
    expect(isFreeModelId("  space-bunny-free  ")).toBe(true);
    expect(isFreeModelId("glm-5.3-flash")).toBe(false);
    expect(isFreeModelId("free-trial-v2")).toBe(false);
    expect(isFreeModelId("freedom-1")).toBe(false);
  });

  it("prefers an explicit free flag over the id convention", () => {
    expect(isFreeTuiModel({ providerId: "p", modelId: "trial-free", free: false })).toBe(false);
    expect(isFreeTuiModel({ providerId: "p", modelId: "promo", free: true })).toBe(true);
    expect(isFreeTuiModel({ providerId: "p", modelId: "trial-free" })).toBe(true);
  });

  it("renders the badge only for zero-cost models", () => {
    expect(freeModelTag({ providerId: "p", modelId: "space-bunny-free" })).toBe("free");
    expect(freeModelTag({ providerId: "p", modelId: "kimi-k3" })).toBeUndefined();
  });
});
