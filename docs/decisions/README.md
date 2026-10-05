# Decisions

One file per accepted decision, named `YYYY-MM-DD-<slug>.md` by the date it was
accepted. The date in the name is the decision date, not the date the file was
last touched.

## Why this exists

Architecture documents describe the system as it is. They cannot carry the
*reason* a shape was chosen over the alternatives that were also viable, and
that reason is what a future change has to argue against. Without it, the same
question is reopened from scratch, or worse, a deliberate constraint is removed
because nothing recorded that it was deliberate.

A decision note is the durable record of that reasoning. It is written once,
when the choice is made, and it is not edited afterwards.

## When to write one

Write one when a change:

- fixes the shape of an interface other work will build on,
- chooses one of two or more viable designs,
- adds a constraint whose purpose is not visible from the code,
- or accepts a tradeoff that will look like a mistake without context.

Do not write one for a bug fix, a rename, or an implementation detail that any
reader could re-derive from the code. Prefer a code comment for those.

## Format

```markdown
# <Title>

- **Status:** accepted | superseded by <link> | rejected
- **Date:** YYYY-MM-DD
- **Context:** the constraint that forced a decision

## Decision

What was decided, stated so it can be argued with.

## Alternatives considered

What else was viable, and the concrete reason each was not chosen.

## Consequences

What this makes easy, what it makes hard, and what would have to change for
this decision to be revisited.
```

## Rules

- A decision is **superseded, never edited**. To change one, add a new note and
  set the old one's status to `superseded by <link>`.
- Keep it short. If it needs more than roughly a page, the design probably
  belongs in `architecture.md` with the note recording only the choice.
- Link the note from the code or document it governs, so it can be found from
  where the constraint is felt.
- English, like the rest of `docs/`.

## Index

| Decision | Governs |
| --- | --- |
| [Automatic learning binds to the runtime, not to the test seam](2026-09-30-automatic-learning-runtime-binding.md) | `packages/local-runtime-v2/src/service/automation/` |
| [Goal activation from a natural-language message](2026-09-30-natural-language-goal-kickoff.md) | `packages/tui/src/application/thread-goal-intent.ts` |
| [Settled model attempts record why, in a closed vocabulary](2026-10-04-durable-attempt-reasons.md) | `local_runtime_llm_requests`, `RequestSettleReason` |
| [A declared future history format is refused; an absent one is tolerated](2026-10-04-refuse-declared-future-history-format.md) | session history `manifest.json` |
| [The team roster is a durable record, and what it does not protect](2026-10-04-team-roster-record.md) | team plan state, `LocalTeamMemberRecord` |
| [Adopting DeepSeek Harness practices by tier](2026-10-04-adopting-deepseek-harness-practices.md) | verification, documentation, and orchestration scope |
