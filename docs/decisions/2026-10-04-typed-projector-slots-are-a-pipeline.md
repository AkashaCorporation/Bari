# The typed projector slots are a pipeline, not a registry

- **Status:** accepted
- **Date:** 2026-10-04
- **Context:** the projection registry was added as a seam and adopted for the
  best-effort observers. The four typed projector slots (`session`, `messages`,
  `stream`, `turnFacts`) were expected to be the next adoption, on the stated
  grounds that they were enumerated by hand at three delivery sites and a new
  one could be half-wired and inert. Reading the delivery code before changing
  it showed that description was wrong.

## What the code actually does

`projectRuntime` is a sequenced pipeline:

1. `session.projectRuntimeEvent` **returns the acknowledgement**. The result is
   validated, is what the caller receives, and its absence raises
   `AgentEventAcknowledgementError` before anything else runs.
2. `messages`, `stream`, `turnFacts` project the same event, in that order.
3. The runtime sequence is committed, then the observer is notified.

The history path is `messages` then `turnFacts`, then the turn fence, then the
observer.

## Decision

**Do not convert this pipeline to the registry.** Document it instead.

## Alternatives considered

- **Register the four slots as units.** Rejected: the registry's units are
  independent and interchangeable, and these are not. A unit cannot express
  "this one's result is the answer and the rest must not run without it", and a
  registry that grew ordering and result propagation would be a second
  implementation of the loop it was meant to simplify.
- **Add a fifth slot by appending.** Rejected as a possibility, not as a
  proposal: the position in the sequence is the design decision, so adding one
  means choosing where it belongs.
- **Leave it undocumented.** This is what allowed the wrong description above.
  The pipeline's order is invisible from the interface, which only says the
  slots exist.

## Consequences

- The four slots stay type-enforced (`RequiredAgentEventProjectors`) and
  runtime-validated (`assertAgentHostCapabilityAvailable`), so a missing slot
  fails at composition rather than silently doing nothing. The half-wired risk
  that motivated the registry does not apply here.
- `docs/events.md` now describes the order, because the interface cannot.
- The registry keeps one adopter (the observer surface) rather than two, which
  is honest: a seam adopted where it does not fit is worse than a seam adopted
  once.
- If a future change makes these slots genuinely independent, this note is the
  place to revisit the decision.