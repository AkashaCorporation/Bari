# Bari selective integration of MiniMax Code 0.5.5 fixes

This update adapts reviewed public MiniMax Code commits to Bari. The source is
the public `MiniMax-AI/minimax-code` repository, not an internal monorepo export.
Workspace imports use `@bari/*`; Bari's branding, provider support, agent roster,
memory tools, privacy defaults and package ownership remain in place.

## Public provenance

| Requested change | Public commit | Original author |
| --- | --- | --- |
| #304: Windows PowerShell native exit codes | `1c641656973c3046c7d514b045b275a1c3f72ca7` | Fizz; Ralle1976 and qinjiu credited upstream |
| #290: Windows config persistence | `432005c0c2f5fab4fd94da2629e7f06257c441c2` | DanielWalnut |
| #287: message write contention and cancellation | `4357fe493125fc6bd90839594e77e7038ec0ac7a` | DanielWalnut |
| #314: long-session history processing | `76deb1caa0fbe4c97db99cb613c93e4feda5c687` | SaladDay |
| #367: compaction, Bash deadlines, memory output and proxy | `258adde0cafe4b4025e88a74624ae203d811c5ad` | DanielWalnut |

History prerequisites are #250 (`3b3310f37eef18d3e0513537169f039c2dddcbc3`),
#254 (`6d79b10e2f8f8c68ef08212b8ed8d476619d90e1`),
#277 (`c8babc718ebceda2e2bbaac556fb42cda189ebc5`) and
#281 (`35f73f7e40279cb312eaf6e100156cfcea8c5bae`). Their original authors are
DanielWalnut (#250) and SaladDay (#254, #277, #281).
Bash contract prerequisites are `61c4c31b9cfdaf508b281ee4d510ce63f307464a`,
`2afb1aeb213bbf74a23a15d1c859fab3df7c3f69`,
`2943a879e027035bc47e2dae0e5e1559c2ec554b` and
`ba92d63f34fbe426f8db5ef8bace73cb2c7e99e6` (muyu).
Existing third-party notices and the Pi patch ledger retain their attribution.

Windows execution exposed an additional update-validation prerequisite:
#351 (`18e72783a8c25c1cf9dad89859a8ac9417e47cce`, vesper, with muyu credited).
Its runtime changes are included; regression coverage uses the existing
`update-service.test.ts` and executable-resolution suites instead of importing
the separate upstream Windows gate. Real shell output fixtures select syntax
for the configured shell, and Windows history-link checks use a junction so
they exercise link rejection without requiring elevated symlink privileges.

The suite runner also adopts the Windows single-worker policy from #181
(`4c0d8297c7e2865352a8786994b3e3b090cb35a8`, DanielWalnut). This avoids concurrent
SQLite/watch fixture contention without increasing test deadlines. Directory
link tests use junctions on Windows. Three tests that specifically require file
symlinks probe the account capability and remain explicitly skipped when Windows
denies their creation; privileged Windows and POSIX hosts still exercise them.

The #367 source note cites internal extraction revision
`d28ae33c08a907f5e1ef17d70725eea0d0c667a0`; that identifies upstream provenance,
not a Git revision imported into Bari. The public source was observed through
`0f6ad5229ff1f144c72dd15a4b2d520feb26cd3d` on 2026-09-27. Unselected commits are
not implied to be integrated, and the still-open #319 is not included.

## Included behavior

- Managed foreground Bash defaults to a one-hour total timeout and caps larger
  requests at one hour. The 60-second foreground yield preserves the running
  process and its original deadline. Explicit background tasks use a one-hour
  runtime watchdog by default; explicit command timeouts remain separate.
- Automatic context compaction reserves output space before reaching the context
  limit. Checkpoint output scales with the model window; reasoning-only output
  exhaustion advances to a smaller candidate. Provider errors get one bounded
  logical retry. Automatic failures retain the original history; valid manual
  checkpoints are committed even when a local next-request estimate rejects them.
- Update downloads reuse the TUI's proxy and loopback-bypass policy and load
  their network dependency lazily. Existing public installation ownership and
  registry selection remain intact.
- Memory-tool results have a 16 KiB model-facing limit with a head/tail preview
  and guidance for reading more. This does not upload memory or change its storage.

Bari retains its own release version. This source update does not republish
an npm package, move a release tag, or advance the full extraction baseline.

## Privacy and publication decisions

| Surface | Decision |
| --- | --- |
| Usage, metrics and diagnostics | Keep the public independent opt-ins, disabled defaults, and `DO_NOT_TRACK` / `MCODE_DISABLE_TELEMETRY` overrides. |
| Evaluation capture and data contribution | Do not import automatic capture wiring, evaluation payload/transport expansions, or default-enabled contribution behavior. |
| Workspace collection and indexing | Keep snapshot collection, archive creation, background upload/retry and semantic-index activation excluded. |
| Feedback and automatic error reports | Keep the public reviewed-text/count-only feedback projection and allowlisted diagnostic schemas; no raw conversations, tool output or workspace files. |
| Compaction observations | Import only local content-free count/budget/outcome facts; preserve the existing public telemetry consent boundary. |
| Managed account, BYOK, plugins, connectors, search and user-requested deployments | Preserve supported public clients and behavior. No private endpoints, generated service contracts or new cloud authorization dependencies are introduced. |

The reviewed update is selective. The older `release/extraction.json`
`sourceRevision` remains the base for future three-way comparisons: changing it
would incorrectly mark the remaining runtime ownership migrations, service
integrations and source-tree moves as synchronized. Those changes need their own
public dependency and privacy review. Private candidate reports remain outside
this repository and are not publication artifacts.

## Validation boundary

Imported tests exercise compaction failure/recovery, budget boundaries and real
Bash execution using synthetic data. Public privacy tests inspect the outgoing
telemetry/diagnostic data, including the final feedback archive. The repository's
full verifier additionally checks source export, types, build boundaries, TUI,
headless BYOK, ACP, permissions and platform-applicable sandbox behavior.

Offline tests are not evidence of live-service ingestion, model quality or
Windows/Linux runtime acceptance. Actual check results belong in the pull
request's validation record.
