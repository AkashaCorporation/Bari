# The team roster is a durable record, and what it does not protect

- **Status:** accepted
- **Date:** 2026-10-04
- **Context:** the team feature already ran plans with per-task results and an
  `engine_sessions` map, but participation was implicit: a member existed only as
  a key in one map and a string in another, and the two could disagree with
  nothing able to tell. There was also no place to ask who was on a team.

## Decision

Add a durable roster to the plan record: one `member` entry per participant with
`member_id`, `agent_name`, `session_id`, `role` and `joined_at`. A session joins
by presenting its own id; the agent name is taken from the session record rather
than from the request, so a caller cannot label a member as someone else.

Only `worker` and `verifier` are joinable. `owner` is recorded at plan creation
and is deliberately not claimable by joining, because every owner-only operation
would become ambiguous with two owners.

Records written before the roster existed read as an empty roster, so every
reader shares one shape instead of each deciding what absence means.

## Alternatives considered

- **Derive the roster from `engine_sessions` and `assignedTo`.** Rejected: that
  is the situation being fixed. Derivation cannot represent a member who has not
  been assigned work yet, and cannot hold a role.
- **Store the roster beside the plan rather than inside it.** Rejected: the plan
  record is already written atomically and read as a unit, so a second file
  would add a consistency problem (two files, one truth) for no benefit.
- **Require the plan owner to add members.** Rejected for the first slice: it
  makes joining a two-step operation for the common case of a session offering
  itself for work, and the owner can still see the roster before dispatching.

## Trust model, stated rather than implied

Joining proves possession of a session id, not authority over it. That matches
the surrounding plan API, which already trusts a caller-supplied `from_session`,
and this note exists so the roster is not mistaken for an authenticated claim:
the guards are against unknown sessions, duplicate membership and unjoinable
roles — **not** against a caller claiming to be another session. A deployment
that needs authenticated membership has to authenticate the transport first.

## Consequences

- A team can be inspected before work is dispatched, and membership survives a
  restart with the plan.
- The roster is at most as trustworthy as the API caller. Nothing here should be
  used to make an authorization decision.
- A mailbox (the remaining Agent Teams primitive) can now address known members,
  which is why the roster came first.