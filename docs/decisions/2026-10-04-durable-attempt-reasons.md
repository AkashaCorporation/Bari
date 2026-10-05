# Settled model attempts record why, in a closed vocabulary

- **Status:** accepted
- **Date:** 2026-10-04
- **Context:** every physical model request is already recorded durably in
  `local_runtime_llm_requests`, one row per attempt, with tokens, cost, timing
  and an `outcome` of `success | error | abort`. A settled failure was
  therefore durable but not diagnosable: across a session nothing distinguished
  a provider outage from a context overflow from a user cancel, and the signals
  that could tell them apart were available at the one point that settles the
  request and were discarded there.

## Decision

Record a `settle_reason` on the attempt row, populated from the classification
the settler already computes, and expose failed and aborted counts on the usage
bucket so a settled failure is visible where usage is read.

The reason is a **closed vocabulary** (`completed`, `aborted`, `provider-error`,
`stop-error`, `thrown`, `no-response`), validated before it is written, and it
is never the provider's message.

## Alternatives considered

- **Store the provider error text.** Rejected. The ledger's stated promise is
  numeric facts and no prompt, content, errors, headers or credentials. An error
  body can carry prompt fragments, key prefixes and account identifiers, so
  storing it would break a published privacy property to gain detail that a
  classification already supplies. The guard is in the write path precisely so a
  later caller cannot reintroduce it by accident.
- **Derive the reason at read time from other columns.** Rejected: the signals
  (`thrown`, the provider error, the stop reason) exist only while the request
  settles and are not reconstructable later.
- **Free-text reason with a length cap.** Rejected: a cap bounds size, not
  content, and the privacy property is about content.
- **Leave `outcome` as the record and treat the vocabulary as unnecessary.**
  Rejected: `error` covers every failure mode, which is the condition this note
  exists to fix.

## Consequences

- Diagnosing a failed session no longer needs the original process to still be
  running; the reason survives a restart with the row.
- The reason is coarser than a provider message. That is the trade: a
  classification that is always safe beats a message that is sometimes the
  answer and sometimes a leak.
- `sumRequestUsageBuckets` only sums the failure counters when a bucket reports
  them, and leaves them absent otherwise, so an aggregate never fabricates a
  zero it did not observe.
- The reason is derived at the single settlement point in
  `pi-turn-runner/metrics.ts`. A second settler would need to classify too, or
  its rows keep a NULL reason.
