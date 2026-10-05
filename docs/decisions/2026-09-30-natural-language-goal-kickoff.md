# Goal activation from a natural-language message

- **Status:** accepted
- **Date:** 2026-09-30
- **Context:** `/goal <objective>` was the only way to start a Goal. Users
  wrote the trigger in prose instead ("vamos subir isso com goal") and nothing
  happened, so the feature stayed invisible unless the command was memorised.

## Decision

A user message that names Goal as the working mode starts a Goal immediately,
with the rest of the message as the objective. Recognised forms are the trigger
phrases the product already teaches — `com goal`, `no goal`, `modo goal`,
`goal mode`, `use goal`, and a leading `goal:` label.

Three constraints make it safe to run on every submission:

1. **The trigger must sit at an edge of the message**, at the start or the end.
   A mid-sentence mention ("vamos fazer isso com goal e depois testar") is
   ordinary prose and must not be hijacked.
2. **A leading trigger must end at a boundary** — punctuation or a `to`/`para`
   connector — so "com goal tracking melhorar X" stays normal work.
3. **An active Goal is never rewritten implicitly.** If a Goal is already
   running, the message continues as normal work. `/goal` remains the only way
   to edit one, because silently replacing a running objective would discard the
   user's stated intent without a visible action.

Detection runs before any optimistic projection of the submitted message, so a
consumed kickoff never leaves a phantom user message behind.

## Alternatives considered

- **Matching the bare word `goal`.** Rejected: it fires on ordinary prose about
  goals ("the goal of this function is...") and would create Goals nobody asked
  for.
- **Replacing an active Goal with the new objective.** Rejected: the user sees
  text they typed become a different objective than the Goal they are already
  pursuing, with no confirmation.
- **Requiring a confirmation prompt on every detection.** Rejected: it makes the
  fast path slower than typing `/goal`, which is the thing being improved. The
  conservative matching rules are the safety, not a confirmation step.
- **Handling it in the model instead of the parser.** Rejected: starting a Goal
  is a state change the user can be held to; it must be decided by a rule that
  can be tested, not by model judgement.

## Consequences

- The message text is consumed, so it is not also sent as a chat turn. This
  matches `/goal <objective>`, whose kickoff already starts work on its own.
- Recognised phrasings are enumerated in one module, so adding a phrasing is a
  one-line change with a test.
- Any failure falls back to a normal submission with a warning, so detection can
  never block the user's work.
- The rules are deliberately conservative: a phrasing that is not enumerated
  will be missed rather than over-matched. Missing a kickoff costs one `/goal`;
  a false positive costs a wrongly created Goal.
