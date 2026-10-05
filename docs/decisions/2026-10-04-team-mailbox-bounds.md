# The team mailbox refuses rather than drops, and only members are addressable

- **Status:** accepted
- **Date:** 2026-10-04
- **Context:** the roster gave a team a durable list of participants, so a
  mailbox finally had destinations to check against. The mailbox lives in the
  plan record, which is written whole on every change.

## Decision

A message is stored only when the sender is on the roster **and** the recipient
is. A full mailbox refuses the next message instead of discarding the oldest.
Only the addressed session may acknowledge a message, and acknowledging twice is
a no-op that reports the message was already read.

Bounds: 4096 characters per body, 500 messages per plan.

## Alternatives considered

- **Drop the oldest message when full.** Rejected: silently discarding a
  coordination message leaves a team acting on a conversation that lost a line,
  and nothing in the transcript says so. A refusal is visible to the sender.
- **Store the mailbox in its own file.** Rejected for now: the plan record is
  already written atomically and read as a unit, so a second file adds a
  two-sources-one-truth problem. Bounded growth is what makes keeping it inside
  the record acceptable; unbounded growth would force the split.
- **Accept a message to any session id.** Rejected: a message to a session that
  never joined is stored for nobody and read by nobody, and the sender cannot
  tell the difference from a delivered message.
- **Let any member acknowledge on behalf of the recipient.** Rejected: the
  unread count is only meaningful if it means "this session has not read it".

## Consequences

- The mailbox cannot lose a message without the sender learning that it did.
- A team that fills the mailbox has to acknowledge and clear; the failure is
  explicit and actionable rather than silent.
- Message bodies are stored as written. This is a coordination channel between
  sessions that already share a workspace, not a confidential one, and nothing
  here filters content — a deployment that needs that must add it.
- Sending proves possession of a session id, exactly as joining does. See the
  roster note: neither is an authorization primitive.