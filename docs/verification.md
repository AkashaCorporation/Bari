# Verification records

## Initial repository import, 2026-09-18

The reviewed 0.4.12 CLI snapshot was imported at `c59cf5377045aa1a3e699c242d089b73b7cdc2ad` on top of the existing Bari Desktop support history. Commit `4e2e7bb5f771e9c42b2edefb1046483819b9032f` restored the Desktop image above the download links. The resulting tree ID, `327eb838c8bdc3da70d9e5f165ca6162a1d15545`, matched the reviewed source tree, and internal Git history was not imported.

Before import, `pnpm verify` passed all 14 applicable gates at implementation revision `1670bafd684ebf8dbb03dd41330ac2b099ffaf23` on macOS arm64 with Node.js 26.4.0 and pnpm 9.12.0, including 3,352 capability tests. History, exported-source, and built-distribution Gitleaks scans completed without unaddressed findings. Issue-form routing and Feishu payload generation used synthetic offline inputs and sent no notification.

Windows CI exposed fixture teardown races during preparation. The fixes drain background delivery before closing SQLite, normalize temporary paths for the Vitest runner, and require image-preview Workers to exit cleanly. These changes affect test fixtures and shutdown checks, not product behavior.

On the imported commit, the Linux and macOS Source verification jobs passed; the Windows job was cancelled by the immediate README follow-up. The follow-up passed the documentation profile and Release audit. A future source release still needs a completed final-revision platform matrix, Node compatibility run, and source candidate.

## Dependency security and unused implementation cleanup, 2026-09-18

The standalone workspace pins Vitest and its coverage package to 4.1.11, Vite to 7.3.6, Hono to 4.13.5, and Ajv's fast-uri to 3.1.6 through root overrides. The runtime uses smol-toml 1.7.1. Central overrides also cover vendored workspace development dependencies without rewriting upstream manifests. The suite launcher resolves the executable from Vitest's package manifest because the newer package no longer exports its CLI as a module subpath.

The TOML import regression runs the actual AgentImportService in a bounded child process: valid input succeeds, while comments ending unterminated arrays or inline tables are rejected. A subprocess timeout prevents a synchronous parser regression from hanging the test runner.

The unused Team cycle engine and two unreferenced adapters are removed. Legacy queue, lock and run-location modules retain the compatibility types required by shared adapters; their unused implementations are removed in place. The source inventory, package paths, lockfile and declared dependency licenses are regenerated. This change does not claim live-service acceptance or alter the repository's publication scope.

## Current source verification status

The current source target is TUI **0.4.12**, with the separate versions described in [Source status](open-source-status.md#version-and-evidence-baseline). The import results above are the current repository baseline. The 0.3.11 results below remain a historical record and have not been relabeled as current acceptance.

Fresh login/logout, cross-platform interactive acceptance, and a validated three-platform source candidate remain **NOT RUN / unavailable** for the imported revision. Add later results with their revision, environment, and scope instead of replacing the historical record.

### Bari 0.8.0 Preview 1 release-candidate acceptance, 2026-11-16

An isolated Windows candidate on Node.js 24.22.1 and pnpm 9.12.0 passed all
16 applicable `archive` verification gates. The reviewed inventory contained
4,349 public paths, the build contained 6,300 source files, and reachability
proved 26 product surfaces present with one declared legacy exception. Release
tooling passed 20 tests with one platform skip; the capability sweep passed
4,247 tests with 43 declared skips; the serial contention gate passed 125 tests;
the status contract passed 9 tests; smoke passed 15 tests with one platform
skip; and offline BYOK passed with two declared cancellation skips.

The MCP name registry and history snapshot suites were moved from the parallel
capability sweep to the declared serial contention scope after repeat 20-second
load timeouts. Both complete files passed in isolation before the move (16/16
and 97/97), and the final serial gate passed all 125 tests without increasing a
timeout or removing an assertion.

Focused provider/runtime/TUI acceptance passed 331 tests, and Akasha package
identity/update coverage passed another 63 tests. A real 80-column PTY
render showed the Bari wordmark, `AKASHA CORPORATION // AGENTIC ENGINEERING`,
the blue/gold palette, operator console and 0.8.0-preview.1 version. Catalog-only
`provider refresh --all` performed no model inference: Experimental Labs settled
at 309 IDs and the current OpenCode Go connection at 41; an older duplicate
OpenCode connection and Xiaomi returned `401`, while ChatGPT OAuth discovery was
unavailable in that attempt. These failures were isolated and did not roll back
successful catalogs. Paid inference and provider quality were intentionally not
tested.

The candidate was built outside the live `dist` directory because another Bari
agent was using that directory on Windows. No running agent was stopped. At the
time of this acceptance record, no commit, push, tag, GitHub release, npm
publication or diagnostic upload had been performed.

The npm preview tarball contained 793 entries and was 12.4 MB. An isolated
install completed with zero audit findings. Its first native install selected a
Node 22 executable from `PATH` despite npm itself being launched by Node 24,
which correctly produced an ABI mismatch at runtime; rebuilding only
`better-sqlite3` and `node-pty` with Node 24 first on `PATH` restored a successful
SQLite-backed startup. The installed CLI then reported `0.8.0-preview.1` and
loaded an isolated provider profile. Recovery/update commands now identify the
public package as `@akashacorporation/bari` while retaining explicit support for
legacy MiniMax package identities.

### OpenCode Go endpoint migration acceptance, 2026-11-01

OpenCode Go moved its harness endpoint from the retired
`https://opencode.ai/zen/go/v1` route to
`https://opencode.ai/inference/go/openai/v1`. Bari now publishes the current
base in its provider preset and canonicalizes saved legacy Go bases before
connection tests, discovery or inference. Both legacy and current official Go
paths receive a stable per-conversation `x-opencode-session` header and the
`User-Agent: Bari` identity; connectivity probes use independent generated
session IDs. Ordinary non-Go OpenCode routes and third-party proxies remain
unchanged.

Focused provider-preset, connectivity and model-resolution regressions passed
141 tests. They cover every supported protocol path, replacement of stale
case-variant identity headers, current request URLs, stable conversation IDs,
isolated probe IDs and redirect-free migration of the retired base. Full
typecheck and the 6,300-source build passed. A bounded live connection probe
through the rebuilt terminal no longer returned the missing-session-header
response; it reached credential validation and returned `401`, so the saved
OpenCode credential still needs to be replaced with a current Console key.
Live inference success is therefore **NOT ESTABLISHED**. No credential was
printed or changed, and no commit, push or release was performed.

The integral `archive` profile passed source, generated-contract, release-tool,
typecheck, build, entrypoint, reachability, standalone and artifact gates before
the capability suite reported 4,351 passes, 43 declared skips and two 20-second
timeouts in the unrelated multiprocess MCP name registry. That complete
16-test file then passed in isolation in 1.01 seconds. This is recorded as
**PASS-WITH-HOLDS**, not a clean integral pass: the evidence supports load
contention, but the integral run itself remained failed and later gates were not
run.

### Experimental Labs catalog refresh wrapper acceptance, 2026-11-01

The explicit Experimental Labs sync reconciled the local provider from 320 to
316 configured entries: four disappeared discovered rows were removed, all 314
IDs returned by the account-visible `/v1/models` endpoint were retained, and two
manual entries were preserved. A second sync was idempotent with zero additions
and zero removals. Current promotional chat IDs including `gpt-6-luna`,
`claude-haiku-5.5`, `deepseek-v4-flash`, `deepseek-v4.1-flash-1017`,
`deepseek-v4.1-flash-uncensored`, `qwen3.8-27b` and `jev-latest` were confirmed
present. Promotion and plan pricing remain upstream, time-dependent metadata;
catalog synchronization does not claim that every listed model is free for
every account.

The Windows PowerShell wrapper selected an installed Node.js 24.22.1 runtime
whose ABI could initialize Bari and its native SQLite module, while ignoring an
incompatible Node.js 26 runtime. It then completed the real provider refresh and
printed the CLI's structured result. PowerShell parser validation passed. The
wrapper delegates discovery, conservative pruning and credential handling to
the Bari CLI; it does not read or print the provider key. Native decision models
such as `clef-flash` and `gpt-6-luna-decisions` remain catalog-visible but are
not conversational agent models. No model selection, commit, push or release
was performed.

### Provider authentication and Experimental Labs refresh acceptance, 2026-10-24

On Windows with Node.js 22.21.1 and pnpm 9.12.0, live bounded probes
confirmed that the already-authorized ChatGPT subscription route works for both
a direct `gpt-daybreak-blue-latest` turn and an explicitly selected child
`explore` Session. The generic `provider test` command now recognizes that
provider's OAuth connection instead of incorrectly requiring a BYOK API key.

The observed `50112` failure came from a resumed Session whose frozen model
binding still selected `custom_provider:provider-42fa78/mimo-v2.6-flash`, not
from Daybreak Blue. Its upstream response was `401 Invalid API Key`. Structured
BYOK attribution now survives the agent protocol, V2 Session projection and TUI
formatting, so the terminal names the actual provider and upstream reason. An
existing Session still keeps its selected model until the user changes it with
`/model` or starts a new Session.

The explicit `provider refresh` command synchronized Experiential Labs from its
live `/v1/models` catalog. The configuration grew from 278 to 324 entries during
discovery, then exact synchronization removed four stale discovered entries and
settled at 320: all 318 live identifiers plus two preserved manual selections.
The conservative pruning rule never removes a manual, unclassified or currently
selected model, and an empty discovery response never prunes anything.

Live connectivity established `deepseek-v4.1-flash` as usable for this account.
`qwen3.5-27b` authenticated but returned `429 model_requires_purchase`.
`clef-flash` was present in discovery but correctly rejected the chat endpoint
and directed callers to the native decisions API at `/v1/systemone`; a native
decisions adapter was not added in this change. OpenCode Go and the Xiaomi Token
Plan provider each still returned `401` and require replacement credentials.
These are point-in-time account and upstream-service observations, not a promise
of future availability or free-tier policy.

Focused provider, protocol, runtime and TUI regressions passed 71 tests. The
complete `archive` verification profile then passed all 16 applicable Windows
gates: source inventory (4,347 reviewed paths), generated contracts, release
tools, typecheck, a 6,300-source build, 26 reachable product surfaces with one
declared legacy exception, standalone and artifact checks, 4,352 capability
tests with 43 declared skips, 12 contention tests, 9 status-contract tests,
15 smoke tests with one platform skip, and the offline BYOK test with two
declared cancellation skips. No credential value was recorded, and no commit,
push, release or diagnostic upload was performed.

### Analysis Jobs receipt acceptance, 2026-10-22

On Windows with the pnpm runtime on Node.js 24.22.1 and pnpm 9.12.0, the
HexCore Jobs adapter, experimental Hypotenuse Jobs adapter, campaign receipt
ingestion, TUI projection and inactive-draft publisher passed the complete
`archive` verification profile. All 16 applicable gates passed. The capability
suite passed 4,346 tests with 43 declared skips; contention passed 12 tests,
the status contract passed 9, smoke passed 15 with one platform skip, and
offline BYOK passed with two declared cancellation skips. The build contained
6,300 source files, the reviewed public inventory contained 4,347 paths, and
reachability proved 26 product surfaces present with one deliberately
unreachable legacy surface.

Focused producer/campaign/TUI tests passed 42 cases. They cover root APK versus
derived DEX identity, canonical Analysis Contract v1 target/session/job binding,
runtime re-hashing of job/status/provenance/input/output bytes, terminal-state
checks, tamper rejection, partial coverage, experimental Hypotenuse identity,
JADX source-reference classification, state migration, duplicate receipt
rejection, verdict non-promotion and the `analysis-run` non-verdict support
label. Both modified built-in skills passed the skill-creator structural
validator. The HexCore job helper additionally rejects watcher-visible drafts,
changed bytes, stale or mismatched validation reports, unsafe paths and existing
destinations before atomic publication.

The first integral run reached smoke after all earlier gates passed but one
15-second CLI child timed out under load. An isolated official smoke rerun
passed. A second integral run reproduced load-only startup times of 17-20
seconds across several proxy-isolation children while their functional checks
remained unchanged. The shared CLI child timeout was therefore bounded at 30
seconds; no assertion or network-audit rule was relaxed. The final integral run
then passed every gate, including smoke in 33.1 seconds and BYOK in 16.9 seconds.

The canonical HexCore 3.8.5 development baseline was read from
`C:\Users\Mazum\Desktop\vscode-main` and recorded locally with source hashes.
HexCore and Hypotenuse trees remained read-only. No real job was published or
run, no device experiment was performed, and no commit, push, release or upload
was made.

### ChatGPT subscription child-session acceptance, 2026-10-22

On Windows with Node.js 24.21.0, two bounded live runs used the already-authorized ChatGPT subscription provider `custom_provider:openai-codex/gpt-6.1-sol` through `openai-responses`. A foreground `explore` task and a background `worker` task each opened a child Session, read `package.json`, returned the requested marker, and completed successfully. The background path is the same `task` substrate used by Agent Teams.

These results establish that ordinary and background subagents in this checkout resolve the same V2 OAuth route as the parent. They do not establish every model, account plan, role, concurrency level, or workspace policy. The runs consumed the connected account's ordinary usage allowance; bounded diagnostics remain local under `.validation/` and contain no committed credentials.

### Security campaign runtime acceptance, 2026-10-22

On Windows with Node.js 22.21.1 and pnpm 9.12.0, the V2 security-campaign owner,
native `research_coordination` tool, Agent Teams linkage, `CliService`/TUI port and
`/campaign` panel passed the complete `archive` verification profile. All 16
applicable gates passed. The capability suite passed 4,330 tests with 43 declared
skips; contention passed 12 tests, the status contract passed 9, smoke passed 15
with one platform skip, and offline BYOK passed with two declared cancellation
skips. The build contained 6,294 source files, the reviewed public inventory
contained 4,337 paths, and reachability proved 23 product surfaces present with
one deliberately unreachable legacy surface.

Campaign regressions cover frozen target/scope digests, strict schemas, atomic
cross-instance persistence, canonical root-cause fingerprints, expiring leases,
optimistic revisions, local-root containment and streamed SHA-256 verification,
evidence/experiment/duplicate gates, stale and self-review rejection, sensitive
tool-output redaction, validated Team task linkage, role-specific tool authority,
terminal rendering sanitization and diagnostic-upload exclusion. The updated
`security-research` skill passed the skill-creator structural validator.

This is local product and synthetic acceptance, not evidence that a finding is
valid on a live target. No device experiment, external disclosure, commit,
release or diagnostic upload was performed. The ordinary source-export preview
still requires a committed clean tree; the `archive` profile intentionally
validates the already exported source without that mutation.

### Source synchronization verification, 2026-09-18

The reviewed shared-source baseline is `9b9885e42a3cf1a3df1cfa52a46e4fdb034cfcee` (TUI 0.4.12). The standalone projection preserves its process-local protocol and public service configuration. Desktop HTTP/generated transports, cloud handoff, private packaging, and unrelated desktop additions remain excluded.

`pnpm verify` passed all 14 gates on macOS arm64, Node.js 26.4.0 and pnpm 9.12.0: source inventory (4,210 files), generated paths (121 exports), source export, release tooling (13 tests), typecheck, build, standalone boundary, built artifacts (4 tests), capabilities (2,679 tests), status contract (9 tests), CLI/ACP smoke (7 tests), offline BYOK (1 test), permission policy (115 tests), and macOS sandbox (48 tests). The artifact checks start the packaged image-preview Worker, and the sandbox suite includes real `sandbox-exec` and Git probes.

The expanded regressions cover model effort, headless preparation cancellation and response usage, image previews, MCP naming and cancellation, background Bash, prompt/agent storage, provider discovery, and content-safety V2. Image-header fixtures are synthetic; production-request images are excluded. Secret scanning covers all Git refs, the exported source, and build artifacts; the test token uses an explicit short placeholder.

Windows/Linux execution, fresh managed-account login, real provider calls, and live content-safety V2 endpoints were not run locally. Offline BYOK fixtures do not establish live-model acceptance. This synchronization does not publish an npm release or change repository visibility.

### Release-preparation verification, 2026-09-12

`pnpm verify` was run on `3de31f0e365e635c52d661c0a14c9ee69e65f099` in an isolated worktree after a frozen-lockfile install, on macOS arm64 with Node.js 26.4.0 and pnpm 9.12.0.

| Gate | Result |
| --- | --- |
| Source inventory, workspace exports and native helper integrity | PASS: 4,096 reviewed files |
| Generated TypeScript paths | PASS: 119 exports |
| History-free source export | PASS |
| Release tooling | PASS: 13 tests |
| Full typecheck | FAIL: `packages/tui/src/cli/network-proxy.ts:134`, TS2724; installed Undici 8 exposes `Dispatcher.DispatchHandler`, while the source references `Dispatcher.DispatchHandlers` |
| Build, standalone checks, artifact/capability/status/smoke/BYOK/policy/sandbox tests | NOT RUN: the full verifier stopped at typecheck |

The failing source file and dependency lockfile are unchanged from the reviewed base `edbd4bd483f9326fae14bed6852950f371d4feab`. At that revision, the preparation changed release metadata, attribution and contributor documentation without repairing the runtime/dependency mismatch. The follow-up below resolves it. A documentation-profile pass must not be substituted for full current-source acceptance.

### Merge-review follow-up, 2026-09-12

Commit `67ad241fb201c618bdedfba5998f7a6fb6f1d0cf` updates the proxy dispatcher's handler annotation to `Dispatcher.DispatchHandler`, matching Undici 8's installed `dispatch` signature. It forwards the handler unchanged and changes no runtime behavior.

On that commit, `pnpm verify` **passed all 14 applicable gates** on macOS arm64, Node.js 26.4.0, pnpm 9.12.0: source checks, generated paths, history-free export, release tooling, typecheck, build, standalone checks, artifact/capability/status/smoke/BYOK/policy/sandbox tests. The capability suite passed 412 tests; the existing real macOS sandbox probes also passed. Local Gitleaks scans of complete Git history, the committed source snapshot and the built distribution reported no findings with the reviewed `.gitleaks.toml` rules.

This resolves the local typecheck failure recorded above. It does not establish Windows/Linux acceptance, successful GitHub Actions runs, a three-platform source candidate or fresh live-service acceptance. Release prerequisites remain separate from this local verification result.

## Historical TUI 0.3.11 acceptance

Verification date: 2026-09-11. Environment: macOS arm64, Node.js 26.4.0, pnpm 9.12.0. Capability baseline: TUI 0.3.11.

This record preserves the clean-directory baseline from managed-capability restoration and adds private release review evidence. Passing tests do not mean all online services have passed acceptance; live evidence appears below and in `release-audit.md`.

## Clean-directory acceptance

Final source was copied outside the repository without `.git`, `node_modules`, `dist`, or `.cache`. A new pnpm store and public npm only were used for a frozen-lockfile install. The build downloaded the pinned Bari package again and extracted mcode-tools without reusing development artifacts.

| Check | Result |
| --- | --- |
| Cold install from public npm | Passed, approximately 1 minute 15 seconds |
| Source inventory, internal references, workspace exports, native helper integrity | Passed, 3979 files at this baseline |
| TypeScript check of the complete entry point | Passed |
| Standalone build and dependency boundaries | Passed; key managed capabilities remained in the output |
| Login, leases, accounts, plugins, connectors, feedback, updates, ACP, Matrix configuration | 21 explicitly selected test files; 321 tests passed |
| Original mcode-tools archive / file hashes, tamper rejection, actual CLI startup | 3 passed |
| CLI, providers, SQLite, ACP initialization, internal-switch rejection, offline local plugins | 7 passed |
| BYOK, session resume, actual file tools, managed-model authentication gate | 1 passed |
| Existing permission facade | 115 passed |
| Vela status protocol | 9 passed |
| Sandbox, executable resolution, actual macOS file / Git probes | 48 passed |

**504 automated tests passed** in total, with relevant validation completed in both development and clean directories.

The BYOK test uses a local OpenAI-format protocol server to drive the actual runtime. It verifies authorization headers, resume history, and real file contents in subsequent model requests, while ensuring Token Plan model overrides still require login. It does not establish real provider quality or production availability.

After managed capabilities were restored, startup could request the model catalog and telemetry. Offline tests return local 503 responses for an explicit public-service allowlist, recording attempts without sending them. Unknown addresses and unexpected TCP connections still fail tests. This verifies some unavailable-service behavior; those failures are not counted as live-service successes.

## Real TUI inspection

A real PTY with an isolated data directory and the network guard confirmed:

- Welcome shows Token Plan as unauthenticated.
- `/provider` presents both MiniMax OAuth / Token Plan and API key options.
- `/login` opens a cancellable China / international region selector.
- `/plugins` shows a clear error for an injected 503. Successful loading and source switching have component / application coverage; this manual check did not connect successfully to the official marketplace.
- `/exit` exits normally and restores terminal state.

That offline PTY check did not open a browser or call a real model. Subsequent online acceptance with an existing account is recorded separately below.

## Private release preparation additions

- Three tests cover source synchronization candidates, preservation of public changes, conflicts, and unsafe-output rejection. A no-change comparison against the actual baseline reported zero changes.
- Full-history, source-snapshot, and build-artifact Gitleaks scans were added. GitHub `Release audit` passed; see `release-audit.md` for false-positive handling and case sanitization.
- Initial Windows CI exposed Git CRLF conversion affecting native helper hashes. `.gitattributes` now pins LF. Later fixes addressed POSIX temporary paths, mock install layouts, and cmd quoting in tests. The relevant 70 tests passed locally; use PR checks for final platform results.
- At that time, GitHub ran macOS / Windows / Linux × Node.js 22 / 24. Each job included frozen install, source checks, source export, build, boundaries, tool artifacts, the 321-case capability suite, status protocol, smoke, and BYOK. Type checking ran once in the Linux / Node.js 22 full profile; the other five jobs used the platform profile, omitting only that compiler gate. Windows skipped one POSIX-only capability case. Permission facade tests ran outside Windows; actual sandbox probes ran on macOS. GitHub runner success did not constitute an interactive user-path check on each physical platform.

## Live production-account acceptance

Using the user-authorized existing login and dedicated temporary workspaces, the following were confirmed:

- A Token Plan MiniMax-M3 session succeeded; resume recovered the previous marker.
- BYOK provider connectivity and a real model session succeeded.
- Events confirmed a successful actual `web_search` call. A separate response that returned a URL without calling the tool was not counted.
- The official plugin marketplace returned 54 available plugins.
- Real bash → mcode-tools → host-lease authentication succeeded. Connector discovery returned 13 tools with no provider failures.

Actual service responses, credentials, and local account paths were not committed. The recorded acceptance results summarize sessions run with synthetic inputs; they do not claim business calls for every plugin or generation tool.

## Not yet verified

- Fresh browser login / logout, full membership quota and billing validation, paid media generation, website deployment, new third-party connector grants / business writes, and feedback / diagnostic uploads.
- Interactive TUI user paths on Windows and Linux; GitHub runner builds and tests are recorded separately.
- Actual update installation / upgrade; the development machine's global installation was not changed.
- Real task quality for each bundled skill, and Desktop features outside the original TUI's defaults.

This historical acceptance did not publish the GitHub source repository or an npm package. The official npm product has a separate release history; its currently verified version is listed in [Source status](open-source-status.md). TypeScript remains strict; `noUncheckedIndexedAccess` and `noImplicitOverride` retain the vendored libraries' existing compatibility settings.

## Windows timeout investigation, 2026-09-12

On commit `4e7582c`, the Windows / Node.js 22 BYOK fixture exceeded its 35-second child-process deadline; the other six CI checks passed. The original failure reported only `Timed out: exec`, without the command phase or captured output, so it does not establish whether execution or process shutdown stalled.

The fixture now records per-command duration, bounded stdout / stderr and execution progress on timeout, plus an opt-in unreferenced process-resource probe. It waits for child `close` before reading complete output, and force-terminates timed-out children before cleanup. The 35-second deadline, 90-second overall bound, default text output, and BYOK / resume / actual-file assertions remain. No runtime behavior or timeout was relaxed. Use the latest PR run for the result; a passing follow-up does not by itself explain the earlier timeout.
