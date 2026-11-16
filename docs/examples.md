# Examples

Build the project using the [installation guide](installation.md). Run the `pnpm bari` commands below from the source root. For interactive tasks, open the target project directory and launch the built CLI by absolute path.

## 1. Edit code and run tests

`examples/clamp` is an intentionally broken exercise with one function and three Node.js tests. It needs no additional dependencies. Copy the directory to a temporary location, open that copy, and start:

```bash
node /absolute/path/to/minimax-code/dist/cli.js
```

Enter:

> Read clamp.mjs and clamp.test.mjs. Run node --test to reproduce the failure, fix clamp without changing the tests, then run the tests again.

In the [real demo](demo.md), two tests initially failed. After correcting the bounds, all three passed. Use `Ctrl+O` to inspect tool details. Choose permissions appropriate for your project; the demo ran in a temporary directory containing only synthetic files.

Resume the most recent session in the current directory:

```bash
node /absolute/path/to/minimax-code/dist/cli.js --continue
```

## 2. Choose your own model

Use `/provider` in the interactive TUI to select a configured model. Before adding a custom provider, set a key in your current shell rather than putting it in command arguments or source:

```bash
# POSIX shell: read the key interactively without echoing it.
read -s MCODE_PROVIDER_API_KEY
export MCODE_PROVIDER_API_KEY
```

In PowerShell, use a process environment variable and treat the input as sensitive:

```powershell
$secureKey = Read-Host 'API Key' -AsSecureString
$env:MCODE_PROVIDER_API_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
```

Add, inspect, and test the provider:

```bash
pnpm bari provider add --name my-provider --base-url https://example.com/v1 \
  --api-format openai-completions --model my-model \
  --context 200000 --max-output 8192 --effort low,high \
  --api-key-env MCODE_PROVIDER_API_KEY --use
pnpm bari provider list
pnpm bari provider test <provider-id> --model <model-id>
pnpm bari provider refresh <provider-id> --json
pnpm bari provider refresh --all --json
pnpm bari exec "Explain this project's test entry points" --model <provider-id>/<model-id>
```

Replace the example URL, model name, and IDs with your configuration and the IDs returned by the list command. `--context`, `--max-output`, and `--effort` are optional metadata for the listed models. `--use` tests the first model before saving and selecting it; when the test fails nothing is saved, so omit `--use` if you want to store the provider first and test it separately. `provider refresh` performs explicit model-list discovery without inference: it adds current IDs and removes only disappeared rows previously marked `discovered`; manual rows and the selected model are retained. `--all` also refreshes the ChatGPT subscription catalog and reports providers with expired credentials without stopping the remaining syncs. The interactive `r` action remains add-only. `exec --model` overrides the model for the current run only. Backslash line continuations are for POSIX shells; use a single line in PowerShell.

`--api-key-env` reads the current environment variable value and stores that value in the active profile's `config.yaml`; it does not save an environment-variable reference. The file still contains plaintext credentials. On POSIX systems, config writes and temporary copies use `0600`. When loading existing files, MCode removes group/other access while preserving the owner's permissions; already-private files such as `0400` or `0600` do not require a permission change. Loading fails if an unsafe main config cannot be restricted. Older migration backups are also checked, but inspection or repair failures produce a warning identifying the directory or backup that needs manual attention rather than preventing the main config from loading. Windows file modes do not provide equivalent ACL protection; restrict access to the profile directory using Windows permissions.

[Live acceptance](verification.md) separately verified MiniMax Token Plan and one configured BYOK provider. This is not a guarantee for every compatible service.

### ChatGPT subscription

In the interactive TUI, open `/provider`, select **ChatGPT subscription**, and choose **Continue with ChatGPT**. Approve Bari and ChatGPT plan usage in your browser, return to the terminal, then select an available model with `/model`. The model catalog comes from the signed-in account; the first completed turn confirms access to the selected model. Eligible Plus and Pro plans can authorize this flow, subject to OpenAI's account, model, and usage limits. API-key usage is billed separately.

Bari uses its own open-source OAuth registration, PKCE, a loopback callback on `127.0.0.1`, and the public Responses API. The browser must be able to reach the callback on the machine running Bari. Device-code sign-in is not offered for this connection. Use separate Bari profiles for separate ChatGPT accounts or workspaces.

The active profile stores registration metadata and protected, rotating credentials in `chatgpt-plan-credentials.json`. Tokens are excluded from `config.yaml`, model lists, and sign-in status. Removing the connected provider clears the local tokens and attempts remote session revocation; the issued registration and host ID are retained for a later sign-in. If remote revocation cannot be confirmed, disconnect Bari in ChatGPT Settings. Existing Codex CLI credentials are not imported.

Requests stream with `store: false`, resend the required conversation history, and expose local function tools through a namespace. A stream that ends without `response.completed` is an error. See the official [registration contract](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), and [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations). Local protocol tests use synthetic accounts and tokens; they do not establish a live account's entitlement.

Changing the configured default does not silently reroute an existing Session: its model binding is preserved for reproducibility and provider privacy. Use `/model` inside that Session, start a new Session, or use a one-run `exec --model` override. Authentication failures from BYOK models identify the actual provider in the TUI instead of being attributed to whichever default model is currently displayed.

### Experiential Labs

For an existing Experiential Labs connection, synchronize its account-visible model IDs with:

```bash
pnpm bari provider refresh custom_provider:explabs --json
```

On Windows, the repository includes a wrapper that locates a Node.js runtime
compatible with Bari's native SQLite module before running the same sync:

```powershell
.\scripts\refresh-experimental-labs-models.ps1
```

Pass `-NodePath C:\path\to\node.exe` or set `BARI_NODE_EXE` when automatic
discovery cannot find the intended runtime. The wrapper never reads or prints
the provider key; provider discovery and conservative pruning remain owned by
the Bari CLI.

The OpenAI-compatible `/models` response is the authority for chat-model discovery. Native decision models such as `clef`, `clef-flash`, and IDs ending in `-decisions` may appear in that catalog but are not Chat Completions models. They use Experiential's `/v1/systemone` decision API and must not be selected as the conversational model. See the provider's [integration contract](https://platform.experientiallabs.ai/docs/integrate).

### OpenCode Go

[OpenCode Go](https://opencode.ai/v2/docs/console/go/) is an optional subscription that serves open coding models, including `deepseek-v4.1-flash`. Subscribe in the OpenCode Console, create a personal API key for that Go workspace, then register it as a provider:

```bash
read -s OPENCODE_API_KEY
export OPENCODE_API_KEY
pnpm bari provider add --name "OpenCode Go" --base-url https://opencode.ai/inference/go/openai/v1 \
  --api-format openai-completions --model deepseek-v4.1-flash \
  --context 1000000 --max-output 384000 --effort low,high,max \
  --api-key-env OPENCODE_API_KEY --use
pnpm bari
```

`--use` runs a connection test with the first model before saving and selecting it; when the test fails, nothing is saved and you can retry with a corrected URL, key, or model ID. `--context`, `--max-output`, and `--effort` declare model metadata; without them the runtime falls back to conservative defaults (for example, a 200k context window instead of the model's real one). You can still select the model later with `/model` in the TUI, or pass `--model custom_provider:opencode-go/deepseek-v4.1-flash` for a single `bari exec` run.

In PowerShell, capture the key with the `Read-Host` pattern above and use `$env:OPENCODE_API_KEY`. Requests to the current `https://opencode.ai/inference/go` endpoint automatically carry a per-conversation `x-opencode-session` header and a `Bari` user agent, so the provider only needs the key. Saved legacy `https://opencode.ai/zen/go/v1` configurations are canonicalized before any request and do not follow a redirect that could drop the session header. The `/provider` wizard lists OpenCode Go with the pinned model catalog, including `deepseek-v4.1-flash`.

## 3. Search and image input

After signing in to MiniMax, try a task that explicitly requires search:

> Use web_search to find the official Node.js test runner documentation. Summarize how to run tests and include the source URL. If the tool is unavailable, say so.

Acceptance observed an actual `web_search` call and returned results; see the [verification record](verification.md). A model returning a URL alone does not prove it used search.

Paste your own image into the TUI, or attach a file explicitly:

```bash
pnpm bari exec "Describe this UI screenshot's layout and suggest three improvements" \
  --file /absolute/path/to/your-screenshot.png
```

The image is sent as input to the selected model service. Use content suitable for sending and a model that supports images. This is an executable usage example, not a live-service acceptance result from this review. Search, image understanding, and media generation are separate capabilities; mcode-tools generation also requires the relevant account permissions and credits.

Use `/plugins` to manage extensions. See [capability coverage](tui-capabilities.md) for custom MCP, managed connectors, and media tools.

## 4. Coordinate a saved agent team

Open `/team` (alias `/teams`) in a running session. The keyboard-driven panel uses the existing terminal feature surface; it does not require switching to fullscreen or changing terminal settings.

1. Create a named preset, such as `HexCore`, and select existing agents from the runtime catalog.
2. Choose agent defaults with parent fallback, or select an exact model allowlist and assign a selected model to each member. A declared family is a label for an explicit saved selection, not automatic manufacturer detection or permission to use future models.
3. Save and activate the preset in the current leader session. Create tasks, assign members, and optionally select prerequisite tasks. Prerequisites must be approved before a dependent task starts.
4. Request a task start. A queued instruction is not proof that a worker has started: refresh the team status and use `/tasks` for live worker sessions and transcripts.
5. Inspect the delivered evidence, then approve or reject that exact revision. `idle`, `submitted`, and `approved` are different states. Only the runtime leader can approve a delivery; a stale review must be refreshed rather than silently approving a replacement delivery.

Presets contain agent/model references, not provider credentials. Messages use the existing session queues. Read-only agents return their normal task results; the leader can record that delivery on the shared board before reviewing it. Provider configuration and model quotas still apply. These steps describe the workflow, not a claim that live paid-model execution was exercised during implementation.

## 5. Run an evidence-gated security campaign

Start or resume a root session and describe the authorized target precisely:

> Create a security campaign for this researcher-owned Android build. Freeze the package/build,
> artifact hashes, program rules, allowed actions, exclusions and local evidence root. Do not create
> a finding yet. Map the surface and create one leased hypothesis per distinct root cause.

The agent uses `research_coordination`; its caller identity and timestamps come from Runtime. Open
`/campaign` (aliases `/campaigns` and `/research`) to inspect the shared state.

1. Record a target identifier such as package/version, firmware fingerprint, commit or image ID. Hash
   every material artifact. A changed build or authorization scope starts another campaign.
2. Create a hypothesis from the attacker position, violated boundary, primitive, privileged consumer,
   lifecycle and impact. An identical normalized fingerprint is rejected rather than assigned twice.
3. Claim the hypothesis before appending evidence, experiments or duplicate checks. Release it before
   a leader verdict or independent review.
4. Register material evidence with its SHA-256, byte count and locator. Runtime resolves local files
   only inside the frozen roots, streams their bytes, and rejects a size/hash mismatch. `inference`
   remains visible but cannot satisfy material evidence gates. Mark private metadata `sensitive` to
   keep its summary, path, locator, tool and command out of provider-visible tool results; it remains
   available in the local campaign panel.
5. For HexCore, author an inactive `*.hexcore_job.draft.json`, prepare its validation request with
   the bundled `hexcore-jobs/scripts/validated-job.mjs`, run the installed
   `hexcore.pipeline.validateJob` against that draft, and use the helper to atomically publish the
   exact validated bytes as `*.hexcore_job.json`. Do not save an unvalidated draft under the watched
   suffix. After the run is terminal, use `ingest-analysis-run` with its status path. Runtime
   re-hashes the job, status, provenance, frozen root target, effective inputs and outputs before
   recording the receipt.
6. Treat `hypotenuse-job` as experimental. Its adapter consumes only Jobs v1 artifacts because the
   toolchain is still changing. APKTool, JADX and smali identities remain separate, and JADX Java is
   stored as `source-reference`, not semantic proof. Missing derived inputs or incomplete function
   coverage keep the receipt `partial`.
7. Record observed experiments separately, including the nearby negative control and cleanup.
8. Have another session produce its own evidence and review the exact current revision. Any later
   mutation makes that review stale. Runtime proves the different session and revision freshness;
   `blind` records the review method but cannot prove what the reviewer saw outside Runtime.
9. Let the root session advance verdicts. Runtime rejects incomplete promotions, and `reportable`
   additionally requires current non-duplicate evidence and a fresh verified review.

Agent Teams may schedule mapper, hunter, validator, duplicate-analysis and reviewer tasks. Include the
campaign and hypothesis IDs in those instructions, then link the exact team task through
`research_coordination`; Runtime verifies that the task belongs to the same root and that a non-leader
caller owns its admitted worker session. Team delivery approval confirms only that scheduled work was
reviewed; it never substitutes for the campaign verdict.
