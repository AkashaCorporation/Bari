# Adopting DeepSeek Harness practices by tier

- **Status:** accepted
- **Date:** 2026-10-04
- **Context:** [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
  (`dsh`, MIT, TypeScript) solves several problems this distribution also has,
  and its architecture is documented in enough depth to reason about from the
  outside. It is also in developer preview and states that compatibility-breaking
  changes are expected, so it cannot be a dependency or a tracked upstream.

## Decision

Adopt selected DSH *practices*, tiered by cost and risk, adapting each to this
repository rather than importing code. Adopted work is proposed as separate,
verifiable changes and is never justified by "DSH does it".

- **Tier 1 — discipline that costs little and prevents concrete failures:**
  decision notes (this directory), an event producer/consumer map, an effective
  composition dump, test suites scoped by concern, and application-entrypoint
  verification.
- **Tier 2 — architecture with real value at medium cost:** durable settled
  assistant attempts, session persistence with immutable generations and
  adjacent migrations, a projection seam, and the capability-seam role test.
- **Tier 3 — one feature only: Agent Teams** (durable roster, task board,
  mailbox over continuable subagents).

## Alternatives considered

- **Tracking `dsh` as an upstream, the way this distribution tracks its own
  origin.** Rejected: developer preview with declared breaking changes, and the
  three-way merge described in `docs/source-sync.md` would carry conflict cost
  for a codebase whose shapes are still moving.
- **Porting the Cordis plugin model wholesale.** Rejected: the value is the
  discipline (registrations are reversible effects with an owner), not the
  framework. Rewriting the extension surface would invalidate working
  subsystems for no user-visible gain.
- **Copying their documentation layout (per-locale `.i18n.yaml`, a notes tree,
  a postmortem tree, module and dependency graphs).** Rejected: this
  distribution documents in one language and its layout is deliberately stable,
  because a published path that moves is a conflict at the next synchronization.
- **Taking Tier 3 broadly (webhook runtime, persistent terminals, output
  spill).** Deferred, not rejected. Agent Teams was chosen because parallel
  agent coordination is the capability this product is actively growing into.

## Consequences

- Every adopted item must be verifiable in this repository on its own terms;
  a practice that cannot be checked here is not adopted, however good it reads.
- The tiers are an ordering, not a promise. Tier 2 items that turn out to need
  a subsystem rewrite are re-scoped rather than half-built.
- Nothing in the adopted set may make the published source layout less stable,
  which is why documentation growth is concentrated in `docs/` content and
  existing directories.
- If DSH later stabilises, this note is the place to revisit whether selected
  code (not practices) can be adopted directly.
