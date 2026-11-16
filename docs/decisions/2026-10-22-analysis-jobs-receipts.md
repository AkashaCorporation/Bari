# Analysis tools cross the runtime boundary as reverified Jobs receipts

- **Status:** accepted
- **Date:** 2026-10-22
- **Context:** HexCore and the evolving Android Hypotenuse toolchain can produce
  useful static-analysis artifacts, but importing their editor or extension
  internals would couple Bari to changing implementations. The HexCore watcher
  also observes `*.hexcore_job.json` on create and change, so writing a job to
  its final name before validation creates an execution race.

## Decision

Bari integrates analysis producers through the versioned HexCore Jobs status
and provenance boundary. `hexcore-job` is the stable adapter. The
`hypotenuse-job` adapter is explicitly experimental and consumes only compatible
Jobs v1 artifacts; Hypotenuse package layout and internal APIs are not a Bari
contract.

Job authoring uses an inactive `*.hexcore_job.draft.json`. A deterministic helper
binds its hash and intended destination, the installed HexCore
`hexcore.pipeline.validateJob` command writes the canonical validation report,
and the helper atomically publishes the exact validated bytes to the watched
filename. Existing destinations, stale validation, changed drafts and path
escapes fail closed.

The V2 `ResearchCampaignService` ingests a terminal run into a versioned receipt.
Runtime reopens and hashes the root target, job, status, provenance, outputs and
available effective inputs. The receipt preserves derivation edges, normalized
configuration hashes, producer/runtime identity, coverage and partial reasons.
Its root digest must match a frozen campaign artifact. A missing effective input
remains declared evidence and makes the receipt partial; it is never silently
treated as the root target.

Ingestion appends evidence and invalidates revision-sensitive reviews, but it
does not change a hypothesis verdict. Decompiled JADX Java is recorded as
`source-reference`, not deterministic semantic proof. APKTool, JADX and smali
remain distinguishable through producer identities, media types and derivation
records rather than being collapsed into one success flag.
Only effective inputs and outputs from a complete `ok` receipt can satisfy the
campaign's `transformations` evidence gate. Control artifacts and every partial
run use the non-verdict `analysis-run` support label.

## Alternatives considered

- **Import HexCore or Hypotenuse extension services directly.** Rejected because
  the standalone product would depend on editor lifecycle and unpublished
  implementation details rather than a file contract.
- **Trust hashes and success flags in producer JSON.** Rejected because copied,
  stale or tampered artifacts would become runtime evidence without checking the
  bytes available under the frozen roots.
- **Write the watched job and validate it afterward.** Rejected because the
  watcher can enqueue the file before validation completes.
- **Let a successful analysis advance the finding.** Rejected because tool
  completion establishes neither attacker control nor realized impact, negative
  controls, duplicate status or independent reproduction.

## Consequences

- Producer upgrades can evolve behind Jobs v1 without changing the campaign
  domain. A Jobs contract change requires a new receipt schema or adapter.
- Receipts are reproducible metadata, not copies of potentially large analysis
  outputs. Artifact bytes remain in authorized local roots.
- Partial coverage and unavailable derived inputs remain visible in the TUI and
  persisted state, which makes incomplete runs harder to mistake for proof.
- Bari can read HexCore and Hypotenuse outputs without modifying either external
  source tree. Publishing a real job or changing those projects remains a
  separate, explicitly authorized action.
