# Automatic learning implementation

Status: the persistence, validation and scheduler core is implemented and tested.
Production lifecycle binding, the maintenance execution adapter, controls and
automatic Compose Next admission are still pending. The configuration defaults
below do not mean background model calls are already enabled in this revision.

## Scheduling contract

`automation` configuration defaults to enabled, including independent
`composeNext`, `dream` and `distill` switches. Explicit malformed switches disable
the affected feature. The bounded defaults are 30 seconds idle, one hour between
runs per workspace/agent, at least six assistant messages, four attempted runs
per UTC day, 24 KiB of serialized evidence/assets, 2,048 output tokens and a
90-second deadline. Zero daily runs disables paid learning. Manual skill use is
independent of these switches.

The core keeps at most 16 pending jobs and deduplicates source session/turn IDs.
It uses an SQLite lease shared by processes and a generation fence per parent
session. New user work invalidates pending results and interrupts active work.
Failed attempts consume budget. Expired owners cannot apply their results.
Jobs require an explicit runtime adapter; the core itself has no model client.
The adapter must disable retries and compaction, expose no tools or plugin
hooks, honor cancellation, and use a visible child session whose purpose starts
with `learning:` so physical requests enter the existing usage ledger.

## Changes and provenance

The model proposes at most two changes to logical memory/skill targets. It
cannot choose filesystem paths. Every proposal requires exact quotations from
captured user/tool evidence; distilled skills require two distinct source
messages. Assistant assertions alone are not accepted. This is traceability,
not proof that a proposed lesson is true or improves future model behavior.
Provider-independent held-out evaluations remain necessary.

Memory uses the existing agent memory location. Managed skills live outside
the repository, scoped by canonical workspace identity and agent identity.
Manual agent skills retain higher discovery priority. Managed skill frontmatter
only accepts a name and a plain description; it cannot declare tool/permission
overrides. Obvious credential patterns, unsupported paths, ambiguous edits and
over-budget assets are rejected. Each existing asset must be valid UTF-8 and
at most 32 KiB; larger assets currently cause capture to skip rather than
silently truncate and replace unseen content.

Apply rechecks the current content hash and parent generation under a file
lock shared with normal memory writes. Each mutation has a durable intent,
before/after hashes and text, and quoted evidence. Run reports retain source
message IDs and hashes, including partial failures and rollback. A conflicting
later target yields `partially_applied`, with the earlier change still
individually reversible.

Rollback restores only content whose current hash matches the applied image.
Later manual edits produce a conflict and remain intact. Interrupted apply and
rollback intents are reconciled using both hashes. The journal retains change
images for the latest 128 runs; older images expire explicitly while run
tombstones retain scheduling deduplication. Expired images are not reported as
successfully restored. These local before-images can contain memory text and
must be treated as private profile data, never published as evaluation output.

## Validation boundary

`test/automation-learning.test.ts` exercises actual SQLite migrations and
cross-connection admission, filesystem apply/rollback, normal memory locking,
policy changes, source validation and the scheduler through synthetic ports.
It makes no live-provider requests and does not establish production wiring or
a quality advantage over the original harness. Final integrated verification
and paired held-out model evaluations are separate delivery gates.
