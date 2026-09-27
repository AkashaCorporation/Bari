# Request accounting and the terminal usage view

Bari records physical model requests locally. The status line shows reported
tokens for the current session, its agents and automatic learning. `/usage`
opens the breakdown and a compact visualization; narrow terminals use stacked
values. The `token-usage` status item can be reordered or hidden with the existing
status-line settings. Explicit empty settings and build-mode keep their behavior.

## What the numbers mean

- **Own** is the selected session's requests, including its retries, compaction
  and title requests.
- **Agents** includes delegated task descendants and side conversations attached
  to this session. Ordinary forked conversations have independent totals.
- **Learning** contains Dream/Distill maintenance tasks and their descendants.
- **Total** adds those three disjoint groups once. Auxiliary compaction/title
  figures in the panel are subsets already included in that total.

These are session totals, not a causal cost for the latest user message. Each
request also retains its actual turn ID. Agent names are display labels; request
and session IDs establish identity. The owning ancestry is captured when the
request starts, so later reparenting does not move historical consumption.

A pending request, absent usage, malformed counter or interrupted partial stream
remains explicit. An asterisk indicates incomplete or unverified accounting; a
question mark means no numeric value is available. Adapter-initialized zeros are
not treated as reported zero. The three BYOK protocols preserve telemetry
presence before applying numeric defaults. Reasoning is not added to output a
second time; provider-normalized totals include cache tokens once.

The ledger reports observed provider telemetry, not a provider invoice. Optional
positive costs are model-price estimates; unavailable pricing is not recorded as
free usage. Requests outside agent/compaction/title execution, such as standalone
provider connection tests, are outside this view.

## Storage and failure behavior

The local SQLite ledger creates a unique pending row before each observed
request and settles that row once. Retry attempts have independent identities.
Reopening a profile preserves pending/unknown rows instead of inventing a
completion. There is no request text, response content, authorization header or
raw exception in this ledger. It does not enable telemetry uploads.

Accounting observes execution without blocking it on SQLite writer contention.
A failed write marks accounting degraded. An independent exclusive-created
marker in the profile's `v2` directory preserves that warning across reopen when
the database is locked. If both database and filesystem persistence are
unavailable, only the running process can retain the warning: this fail-open
observer cannot promise billing-complete durability through arbitrary storage
failure. The UI consistently describes the scope as recorded usage.

Ordinary session deletion also removes that session's request rows. Existing
peek retention policy continues to apply. Recorded ancestry preserves ownership
for retained rows; it does not override user deletion.

Bari-owned schema additions use migration numbers 1000 and above, keeping them
separate from the MiniMax upstream migration sequence. Migration 1000 adds the
request ledger and its coverage epoch without modifying earlier usage rows.
Anonymous historical usage remains available through the legacy usage API but
is never added to overlapping request totals. Older sessions are labelled
unverified; no model is called to reconstruct missing historical accounting.

## Verification boundary

Synthetic tests cover migration, restarts, nested agents, reparenting, retry
identity, cancellations, missing/zero/partial counters, foreign SQLite writers,
observer failures, auxiliary requests and terminal widths. The built CLI BYOK
test compares actual local HTTP requests with durable request IDs and checks that
a tool response with no telemetry stays unknown. Terminal previews use synthetic
values; they are not measurements of live model quality or billing.
