import { describe, expect, it } from "vitest";
import { detectTuiThreadGoalIntent } from "../../src/application/thread-goal-intent.js";

function objective(raw: string): string | undefined {
  return detectTuiThreadGoalIntent(raw)?.objective;
}

describe("detectTuiThreadGoalIntent", () => {
  it("recognises the conversational trigger at the end of a message", () => {
    expect(objective("vamos subir isso com goal")).toBe("vamos subir isso");
    expect(objective("fazer no goal")).toBe("fazer");
    expect(objective("bora terminar o patch com o goal")).toBe("bora terminar o patch");
    expect(objective("track everything with goal mode")).toBe("track everything");
  });

  it("recognises the trigger at the start and keeps the rest as objective", () => {
    expect(objective("com goal: implementar o parser novo")).toBe("implementar o parser novo");
    expect(objective("use goal to fix the flaky test")).toBe("to fix the flaky test");
    expect(objective("usando goal, refatorar o modulo")).toBe("refatorar o modulo");
  });

  it("recognises a leading goal label", () => {
    expect(objective("goal: corrigir o bug do parser")).toBe("corrigir o bug do parser");
  });

  it("keeps the full text when only the trigger is present", () => {
    expect(objective("com goal")).toBe("com goal");
    expect(objective("goal:")).toBeUndefined();
    expect(objective("   ")).toBeUndefined();
  });

  it("never hijacks ordinary prose about goals", () => {
    expect(objective("the goal of this function is to parse dates")).toBeUndefined();
    expect(objective("implemente o goal system do product")).toBeUndefined();
    expect(objective("com goal tracking melhorar a cobertura")).toBeUndefined();
  });

  it("never hijacks a mid-sentence trigger", () => {
    expect(objective("with goal mode enabled, track everything carefully")).toBeUndefined();
    expect(objective("vamos fazer isso com goal e depois testar")).toBeUndefined();
  });
});
