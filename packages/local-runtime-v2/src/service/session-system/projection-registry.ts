/**
 * The projection seam.
 *
 * A projection unit folds what the runtime already committed into the state a
 * reader needs. Registering a unit here is the whole wiring: the registry
 * delivers every committed fact to every unit that accepts it, so a unit cannot
 * be half-connected to one delivery path and silently inert on another.
 *
 * Three rules this seam enforces, each because their absence was a real failure
 * mode elsewhere in this repository:
 *
 * 1. **A key is registered once.** A second registration for the same key is a
 *    wiring mistake, not a merge: two units folding one key would produce a
 *    state neither of them owns.
 * 2. **A read of an unknown key fails.** `stateOf` throws instead of returning
 *    an empty default, the way a missing override once produced a silently dead
 *    feature. A caller that wants a projection must be able to tell that it is
 *    absent.
 * 3. **One failing unit does not stop the others.** Delivery is best-effort per
 *    unit and the failure is reported, because a projection that throws must not
 *    take the durable commit that triggered it down with it.
 */

export interface ProjectionContext {
  readonly sessionId: string;
  readonly turnId: string;
}

export interface ProjectionRuntimeEventInput {
  readonly context: ProjectionContext;
  readonly event: unknown;
}

export interface ProjectionHistoryCommittedInput {
  readonly context: ProjectionContext;
  readonly change: unknown;
}

export interface ProjectionHistoryFailureInput {
  readonly sessionId: string;
  readonly turnId: string;
  readonly metadata?: unknown;
}

/**
 * A unit declares only the paths it handles. A unit that declares none is
 * rejected on registration rather than registered and never called.
 */
export interface SessionProjectionUnit {
  readonly key: string;
  projectRuntimeEvent?(input: ProjectionRuntimeEventInput): Promise<void> | void;
  projectHistoryCommitted?(input: ProjectionHistoryCommittedInput): Promise<void> | void;
  projectHistoryFailure?(input: ProjectionHistoryFailureInput): Promise<void> | void;
}

export class UnknownProjectionError extends Error {
  constructor(readonly key: string) {
    super(
      `No projection is registered for "${key}". Register it before reading, or require it explicitly at composition.`,
    );
    this.name = 'UnknownProjectionError';
  }
}

export class DuplicateProjectionError extends Error {
  constructor(readonly key: string) {
    super(`Projection "${key}" is already registered; a key has exactly one owner.`);
    this.name = 'DuplicateProjectionError';
  }
}

export class EmptyProjectionUnitError extends Error {
  constructor(readonly key: string) {
    super(`Projection "${key}" handles no delivery path, so it would never run.`);
    this.name = 'EmptyProjectionUnitError';
  }
}

export interface ProjectionDeliveryFailure {
  readonly key: string;
  readonly path: 'runtime-event' | 'history-committed' | 'history-failure';
  readonly error: unknown;
}

export interface SessionProjectionRegistry {
  register(unit: SessionProjectionUnit): void;
  keys(): readonly string[];
  has(key: string): boolean;
  /**
   * Typed read of the state a unit published. Throws for an unknown key: a
   * caller must not silently receive an empty default for a projection that was
   * never registered.
   */
  stateOf<T>(key: string): T;
  /** Publish the state a unit's readers should see. */
  publish<T>(key: string, state: T): void;
  deliverRuntimeEvent(input: ProjectionRuntimeEventInput): Promise<readonly ProjectionDeliveryFailure[]>;
  deliverHistoryCommitted(
    input: ProjectionHistoryCommittedInput,
  ): Promise<readonly ProjectionDeliveryFailure[]>;
  deliverHistoryFailure(
    input: ProjectionHistoryFailureInput,
  ): Promise<readonly ProjectionDeliveryFailure[]>;
}

export function createSessionProjectionRegistry(): SessionProjectionRegistry {
  const units = new Map<string, SessionProjectionUnit>();
  const states = new Map<string, unknown>();

  const handlesSomething = (unit: SessionProjectionUnit): boolean =>
    typeof unit.projectRuntimeEvent === 'function' ||
    typeof unit.projectHistoryCommitted === 'function' ||
    typeof unit.projectHistoryFailure === 'function';

  const deliver = async (
    path: ProjectionDeliveryFailure['path'],
    invoke: (unit: SessionProjectionUnit) => Promise<void> | void,
  ): Promise<readonly ProjectionDeliveryFailure[]> => {
    const failures: ProjectionDeliveryFailure[] = [];
    // Registration order decides delivery order, so a unit can rely on another
    // unit having folded the same fact first.
    for (const unit of units.values()) {
      try {
        await invoke(unit);
      } catch (error) {
        failures.push({ key: unit.key, path, error });
      }
    }
    return failures;
  };

  return {
    register(unit) {
      if (!unit.key || unit.key.trim().length === 0) {
        throw new Error('A projection unit requires a non-empty key.');
      }
      if (units.has(unit.key)) throw new DuplicateProjectionError(unit.key);
      if (!handlesSomething(unit)) throw new EmptyProjectionUnitError(unit.key);
      units.set(unit.key, unit);
    },
    keys: () => [...units.keys()],
    has: (key) => units.has(key),
    stateOf<T>(key: string): T {
      if (!units.has(key)) throw new UnknownProjectionError(key);
      return states.get(key) as T;
    },
    publish(key, state) {
      if (!units.has(key)) throw new UnknownProjectionError(key);
      states.set(key, state);
    },
    deliverRuntimeEvent: (input) =>
      deliver('runtime-event', (unit) => unit.projectRuntimeEvent?.(input)),
    deliverHistoryCommitted: (input) =>
      deliver('history-committed', (unit) => unit.projectHistoryCommitted?.(input)),
    deliverHistoryFailure: (input) =>
      deliver('history-failure', (unit) => unit.projectHistoryFailure?.(input)),
  };
}