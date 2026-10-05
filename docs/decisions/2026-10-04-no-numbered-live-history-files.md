# The live history file keeps one name until a second format exists

- **Status:** accepted
- **Date:** 2026-10-04
- **Context:** the reference design publishes each format as its own numbered
  file (`session.vN.jsonl`) and never renames, replaces or deletes a committed
  generation. A previous note deferred adopting that for this codebase pending
  proof that it was worth moving every session's on-disk layout. Reading the
  write paths settles the question differently.

## What the code already guarantees

- **Creation is exclusive and verified.** `publishInitial` writes through
  `publishJsonlIfAbsent` and asserts the file's revision, so a history that
  already exists is never overwritten by a second initial publish.
- **Snapshots are exclusive too.** They publish through the same if-absent path.
- **Mutation is explicit, atomic and verified.** `replace` and `replaceActive`
  write through `writeJsonlAtomically` and assert the resulting revision. The
  live file is mutable *by an API that says so*, not by accident.
- **Unknown formats are refused.** The session manifest declares its
  `schemaVersion` and `layout`, and a build that does not know them refuses the
  directory instead of reading it as v1.
- **Artifacts already carry validated generations.** A compaction artifact
  records `generation` and a `parentSnapshot`, and decoding requires
  `parentSnapshot.generation + 1 === generation`.

## Decision

**Do not add numbered live-history files.** There is one history format, so the
mechanism would have no second format to hold, and its only deliverable today
would be a new place to put a file that does not exist.

## Alternatives considered

- **Publish `messages.v2.jsonl` beside `messages.jsonl` on the next format
  change.** This is the reference behaviour and it remains the right move *when
  a second format is introduced*. It is not a thing to build in advance: the
  successor file name, the migration step and the generation selector become
  concrete only once the format differs.
- **Number the file now, keeping format v1, as preparation.** Rejected: it
  changes the on-disk layout of every existing session, needs a reader that
  selects the highest generation, and buys nothing until a second format exists.
- **Keep the deferral open as "needs proof".** Rejected: the question is
  answered. It is not that the migration is unproven; it is that there is
  nothing for it to migrate yet.

## Consequences

- The immutability that matters is already present where it matters: a committed
  history is never silently replaced, and an unknown format is refused rather
  than misread.
- The one thing genuinely missing is a **format-version migration path**, and it
  arrives with the first format change, not before. When that happens, the work
  is: add `messages.v2.jsonl` publication, a `v1 -> v2` step, and selection of
  the highest generation on open.
- Publishing a successor beside an unchanged source is the property to preserve
  when that work is done. `publishJsonlIfAbsent` already provides it.