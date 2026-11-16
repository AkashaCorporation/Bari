# Security research truth belongs to a campaign service, not the team board

- **Status:** accepted
- **Date:** 2026-10-22
- **Context:** the built-in security-research skill defined frozen targets,
  evidence levels, negative controls, duplicate analysis and independent review,
  while Agent Teams provided durable scheduling and revision-guarded delivery
  review. Neither surface owned structured research truth. A task delivery was a
  free-form string, and prompt instructions alone could not prevent two workers
  from pursuing the same root cause or promoting an unsupported claim.

## Decision

Add a V2-owned `ResearchCampaignService` reached by the standalone product
through `CliService`, a TUI port and the native `research_coordination` tool.
The service owns an immutable target/authorization snapshot, root-cause
fingerprints, exclusive expiring hypothesis leases, append-only research
records, optimistic revisions and verdict transitions.

Target and scope are frozen together under a SHA-256 digest. There is no update
operation: a materially different build or authorization creates another
campaign. Evidence, experiments, duplicate checks and reviews are appended and
never edited in place. The persisted schema is strict, bounded and versioned;
corrupt or inconsistent state fails closed instead of resetting to an empty
campaign.

Only the campaign root changes verdicts. `reportable` requires material evidence
for every required link, a confirmed experiment with a passing negative control,
an affected-scope record, a current non-duplicate assessment and a fresh verified
review by a different runtime session. The `blind` field records the reviewer's
declared method; Runtime proves session separation and revision freshness, not
what information a reviewer saw outside the service.

Agent Teams remains the scheduling owner. Team tasks may carry campaign and
hypothesis IDs and can be linked after Runtime verifies the common root and the
assigned worker session. Admitted descendants share the campaign through their
real session ancestry. Team completion or approval never changes a research verdict.
The campaign service does not copy conversations, task state or provider
credentials.

Team participation is separate from delegation authority. Built-in workers and
read-only roles may receive `team_coordination` for status, delivery or bounded
communication even when they cannot create descendants. Starting a worker still
requires the independently admitted `task` tool, so exposing coordination does
not bypass the delegation ceiling.

## Alternatives considered

- **Add evidence fields directly to `TeamTask`.** Rejected: generic coding and
  operations teams do not need a vulnerability lifecycle, and task approval is
  not a security finding verdict.
- **Keep the contract only in a skill and report template.** Rejected: prompt
  discipline cannot provide atomic leases, reject stale reviews, detect a
  duplicate fingerprint or fail closed on corrupted persistence.
- **Use embeddings as the duplicate decision.** Rejected: semantic similarity
  is useful for retrieval but does not establish the same attacker position,
  violated boundary, primitive, consumer, lifecycle and impact.
- **Let every worker promote its own result.** Rejected: production and
  adjudication would share one authority, turning repeated assumptions into
  apparent consensus.

## Trust model and limits

- Runtime binds caller session identity; agents cannot supply `sessionId` to the
  native tool.
- Session ancestry grants campaign participation. It does not prove that two
  sessions used different model providers or that a declared blind review had no
  out-of-band context.
- Artifact references are metadata. Material evidence requires SHA-256 and byte
  count; local material references are resolved only inside frozen roots and
  re-hashed by Runtime. External acquisition correctness and program
  authorization still depend on the researcher and the recorded scope.
- Campaign persistence is private runtime state. Publication inventories and
  diagnostic uploads must not include account data or local evidence roots.
  Evidence marked `sensitive` remains visible in the local TUI but its summary,
  reference, locator, tool and command are redacted from model-facing tool output.

## Consequences

- Agents coordinate on one frozen identity and one hypothesis registry instead
  of reconstructing state from chat history.
- Rejected, unknown and duplicate work remains useful negative evidence.
- `/campaign` is read-oriented; natural-language work uses the native tool, and
  mutations continue to pass through runtime authority and revision gates.
- New product files are added in place and must pass source inventory, build and
  reachability checks. Existing Team and session layouts are not moved.
