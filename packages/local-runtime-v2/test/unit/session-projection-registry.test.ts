import { describe, expect, it, vi } from "vitest";

import {
  DuplicateProjectionError,
  EmptyProjectionUnitError,
  UnknownProjectionError,
  createSessionProjectionRegistry,
} from "../../src/service/session-system/projection-registry.js";

const runtimeEvent = { context: { sessionId: "s1", turnId: "t1" }, event: {} };
const historyCommitted = { context: { sessionId: "s1", turnId: "t1" }, change: {} };
const historyFailure = { sessionId: "s1", turnId: "t1" };

describe("session projection registry", () => {
  it("delivers every path to a unit that accepts them", async () => {
    const registry = createSessionProjectionRegistry();
    const unit = {
      key: "turn-boundary",
      projectRuntimeEvent: vi.fn(),
      projectHistoryCommitted: vi.fn(),
      projectHistoryFailure: vi.fn(),
    };
    registry.register(unit);

    await registry.deliverRuntimeEvent(runtimeEvent);
    await registry.deliverHistoryCommitted(historyCommitted);
    await registry.deliverHistoryFailure(historyFailure);

    expect(unit.projectRuntimeEvent).toHaveBeenCalledWith(runtimeEvent);
    expect(unit.projectHistoryCommitted).toHaveBeenCalledWith(historyCommitted);
    expect(unit.projectHistoryFailure).toHaveBeenCalledWith(historyFailure);
  });

  it("delivers in registration order", async () => {
    const registry = createSessionProjectionRegistry();
    const order: string[] = [];
    registry.register({ key: "first", projectRuntimeEvent: () => void order.push("first") });
    registry.register({ key: "second", projectRuntimeEvent: () => void order.push("second") });
    registry.register({ key: "third", projectRuntimeEvent: () => void order.push("third") });

    await registry.deliverRuntimeEvent(runtimeEvent);
    expect(order).toEqual(["first", "second", "third"]);
    expect(registry.keys()).toEqual(["first", "second", "third"]);
  });

  it("delivers only the paths a unit declares", async () => {
    const registry = createSessionProjectionRegistry();
    const partial = { key: "partial", projectHistoryCommitted: vi.fn() };
    registry.register(partial);

    await registry.deliverRuntimeEvent(runtimeEvent);
    await registry.deliverHistoryFailure(historyFailure);
    expect(partial.projectHistoryCommitted).not.toHaveBeenCalled();

    await registry.deliverHistoryCommitted(historyCommitted);
    expect(partial.projectHistoryCommitted).toHaveBeenCalledTimes(1);
  });

  it("refuses a second unit for one key and a unit that handles nothing", () => {
    const registry = createSessionProjectionRegistry();
    registry.register({ key: "owned", projectRuntimeEvent: vi.fn() });
    expect(() => registry.register({ key: "owned", projectRuntimeEvent: vi.fn() })).toThrow(
      DuplicateProjectionError,
    );
    expect(() => registry.register({ key: "inert" })).toThrow(EmptyProjectionUnitError);
    expect(() => registry.register({ key: "  ", projectRuntimeEvent: vi.fn() })).toThrow(
      /non-empty key/,
    );
  });

  it("fails an unknown read instead of returning a silent default", () => {
    const registry = createSessionProjectionRegistry();
    registry.register({ key: "known", projectRuntimeEvent: vi.fn() });

    expect(registry.has("known")).toBe(true);
    expect(registry.has("absent")).toBe(false);
    expect(() => registry.stateOf("absent")).toThrow(UnknownProjectionError);
    // Publishing to a key nobody registered would put state where no reader can
    // find it, so it fails the same way.
    expect(() => registry.publish("absent", {})).toThrow(UnknownProjectionError);
  });

  it("reads back the state a unit published", () => {
    const registry = createSessionProjectionRegistry();
    registry.register({ key: "turn-boundary", projectRuntimeEvent: vi.fn() });
    registry.publish("turn-boundary", { phase: "open" });
    expect(registry.stateOf<{ phase: string }>("turn-boundary")).toEqual({ phase: "open" });
  });

  it("keeps one failing unit from stopping the others and reports the failure", async () => {
    const registry = createSessionProjectionRegistry();
    const after = vi.fn();
    registry.register({
      key: "broken",
      projectRuntimeEvent: () => {
        throw new Error("unit exploded");
      },
    });
    registry.register({ key: "healthy", projectRuntimeEvent: after });

    const failures = await registry.deliverRuntimeEvent(runtimeEvent);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ key: "broken", path: "runtime-event" });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("reports which path failed when a unit handles several", async () => {
    const registry = createSessionProjectionRegistry();
    registry.register({
      key: "half-broken",
      projectRuntimeEvent: vi.fn(),
      projectHistoryCommitted: () => {
        throw new Error("history fold failed");
      },
    });

    expect(await registry.deliverRuntimeEvent(runtimeEvent)).toEqual([]);
    const failures = await registry.deliverHistoryCommitted(historyCommitted);
    expect(failures[0]).toMatchObject({ key: "half-broken", path: "history-committed" });
  });
});