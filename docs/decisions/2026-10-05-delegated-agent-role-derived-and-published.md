# The delegated-agent role is derived, published to ACP clients, and not re-rendered

- **Status:** accepted
- **Date:** 2026-10-05
- **Context:** the team roster stores a `role` per member (see
  [the roster note](2026-10-04-team-roster-record.md)), but that API belongs to
  the v1 host and this distribution does not mount it. The product's own team
  view is derived from delegated sessions, so it had no role at all — while its
  ACP surface published that view to clients, which left a client unable to tell
  a verifier from a worker without re-implementing a product rule.

## Decision

`TuiDelegatedAgent` carries `role`, derived in one place from the agent name: a
builtin `verifier` checks work, every other delegated agent produces it. The
field is published to ACP clients with the delegation snapshot, on
`bari/session/delegation/get` and `bari/session/delegation_update`.

It is deliberately **not stored**: the team is its delegated sessions, so a
recorded role could disagree with the sessions that exist.

It is deliberately **not re-rendered** in the agent-team panel. The member label
is the agent name, so a tag would repeat the word the row already shows.

## Alternatives considered

- **Store the role on the delegated session, so the payload and any display
  share one authority.** Rejected: that is the roster's job, and the roster is
  not mounted here. A second stored copy would be able to disagree with the
  sessions it claims to describe, which is the failure the roster note exists to
  avoid.
- **Render a role tag in the panel.** Rejected with evidence. The row for a
  verifier renders as `› verifier verifier Running Starting · Check the work 0s`:
  the label already carries the name the role is derived from, so the tag is a
  second spelling of the same word, spent from the width that says what the
  agent is doing. Emphasis, if it is wanted later, belongs on the name itself.
- **Leave the role off the payload and let each client derive it.** Rejected:
  that makes every client re-implement which builtin names check work. That is a
  product rule, not a display choice, so it belongs to the producer.

## Consequences

- A client can group or filter agents by role without knowing the builtin names.
- The field looks unused inside this package, because its only consumer is an
  ACP client. Removing it on that reading would take it out of a live payload:
  the `bari/session/delegation/*` methods are present in the published build,
  and `check:reachability` tracks the ACP modules. Look for the consumer in the
  ACP surface before concluding a delegation field has none.
- Revisit if a second surface needs to show the role. The rule is one private
  function, so the change is to give a display a non-redundant use for it — a
  count in the team summary, say — rather than to derive it again.
