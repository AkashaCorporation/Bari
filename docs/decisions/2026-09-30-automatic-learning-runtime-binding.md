# Automatic learning binds to the runtime, not to the test seam

- **Status:** accepted
- **Date:** 2026-09-30
- **Context:** the learning coordinator and its store, assets and proposal
  validation landed as a tested core, but nothing composed it, so no run could
  ever be admitted.

## Decision

The service is composed in `services.ts` whenever the runtime has a real
database, and the `automation.enabled` config decides whether work is admitted.
It is never gated on a test-only override.

Three sub-decisions came with it:

1. **The missing producer was added, not the guard removed.** The coordinator
   already consumed `{ kind: 'learning-maintenance' }` in `before_llm_call` and
   `before_tool_call`, but nothing produced it. An unscoped claim must not gain
   the learning budget, so the intent is projected only from a non-empty run id
   on a `learning` provenance source.
2. **Admission goes through the Turn lifecycle observer**, not through a timer
   watching the transcript. A starting turn counts as the user working and
   makes pending learning yield; a terminal turn admits a run only when it
   actually carried a user prompt, which is how synthetic, resumed and
   host-owned turns are rejected.
3. **The learning turn is the same agent, isolated.** It inherits the parent's
   agent name and model, so it stays inside the parent's budget and ledger, but
   it runs with its own turn intent, no tools and one model call.

## Alternatives considered

- **A separate learning agent.** Rejected: it would need its own registration,
  persona and configuration, and it would fall outside the per-agent budget
  group that exists precisely to bound background work.
- **Admitting runs from a plain idle timer.** Rejected: an idle session is not
  evidence of a finished task, and a timer cannot distinguish a settled user
  turn from a resumed or host-owned one.
- **Gating composition on the test override.** This is the mistake the note
  exists to prevent. `overrides.automation.enabled` is a seam for tests;
  production never sets it, so the feature was silently dead while every test
  stayed green.
- **Removing the coordinator's guards instead of adding the producer.**
  Rejected: it would have turned a dormant guard into a live authority bypass.

## Consequences

- A composition graph that passes a placeholder database is not a runtime and
  skips the bind; owner-graph tests stay valid without inventing a store.
- Automatic model calls now depend on config alone. Changing
  `automation.enabled` is the whole off switch.
- The `learning:` child session is user-visible by design, so a run that
  misbehaves can be inspected rather than guessed at.
- Verified by unit tests over the observer and adapter, not yet by an
  end-to-end run against a live provider. The two are different evidence and
  this note does not claim the second.
