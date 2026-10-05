# A declared future history format is refused; an absent one is tolerated

- **Status:** accepted
- **Date:** 2026-10-04
- **Context:** a session's history lives in a dated directory whose file names
  are fixed (`messages.jsonl`, `ledger.jsonl`, `display.jsonl`, `snapshot.json`)
  and whose `manifest.json` carries `schemaVersion` and `layout`. Identity was
  the only thing validated on open: a manifest whose `sessionId` and
  `createdAtMs` matched was accepted whatever it declared. A build from before a
  format change would therefore read a newer layout with these fixed names
  instead of failing, which misinterprets history rather than reporting it.

## Decision

Opening a session refuses a manifest that **declares** a `schemaVersion` or
`layout` this build does not know, and tolerates a manifest that declares
neither. The version the build writes comes from the same constants it accepts,
so the two cannot drift.

## Alternatives considered

- **Refuse anything that is not exactly this version and layout.** Rejected: it
  would strand sessions whose manifest predates the fields, and the failure
  would look like corruption rather than a version boundary.
- **Warn and continue on a future version.** Rejected: continuing is the
  behaviour being fixed. A version this build cannot interpret is read-only at
  best and wrong at worst, and the user cannot tell which happened.
- **Version the file names** (`messages.v2.jsonl`) the way the reference
  harness does. Deferred, not rejected. It is the stronger design, because the
  directory then holds each generation instead of overwriting one, but it
  changes the on-disk layout of every existing session and the migration has to
  be proven before it is worth that. The manifest check is the part that can be
  added without moving anything, and it is what prevents silent misreading now.
- **Check the version at each reader instead of at the shared assert.**
  Rejected: the shared assert is the one place both the open and the delete path
  already call, so a reader added later inherits the guard.

## Consequences

- A downgrade after a future format change fails loudly instead of reading the
  wrong files.
- `deleteSessionHistory` shares the assert, so a history this build cannot
  interpret also refuses to be deleted. That is deliberate: deleting a directory
  whose layout is unknown discards data the user might still recover with the
  build that wrote it.
- Absence stays tolerated, so a manifest missing these fields keeps working.
  The cost is that a genuinely corrupt manifest without them is not caught here;
  it is caught by the readers that then find no usable records.
- The layout change itself (per-generation files) remains open, and this note is
  the place to revisit it.
