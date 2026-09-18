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
  --api-key-env MCODE_PROVIDER_API_KEY
pnpm bari provider list
pnpm bari provider test <provider-id> --model <model-id>
pnpm bari exec "Explain this project's test entry points" --model <provider-id>/<model-id>
```

Replace the example URL, model name, and IDs with your configuration and the IDs returned by the list command. `--context`, `--max-output`, and `--effort` are optional metadata for the listed models. New providers must pass `provider test` before they can be activated; `exec --model` overrides the model for the current run only. Backslash line continuations are for POSIX shells; use a single line in PowerShell.

[Live acceptance](verification.md) separately verified MiniMax Token Plan and one configured BYOK provider. This is not a guarantee for every compatible service.

### OpenCode Go

[OpenCode Go](https://opencode.ai/docs/go/) is an optional subscription that serves open coding models, including `deepseek-v4.1-flash`. Subscribe there, copy the key from `https://opencode.ai/auth`, then register it as a provider:

```bash
read -s OPENCODE_API_KEY
export OPENCODE_API_KEY
pnpm bari provider add --name "OpenCode Go" --base-url https://opencode.ai/zen/go/v1 \
  --api-format openai-completions --model deepseek-v4.1-flash \
  --context 1000000 --max-output 384000 --effort low,high,max \
  --api-key-env OPENCODE_API_KEY
pnpm bari provider test custom_provider:opencode-go --model deepseek-v4.1-flash
pnpm bari
```

A new provider must pass a connection test before it can be activated, so `bari provider add --use` is rejected until then; select the model with `/model` in the TUI (or pass `--model custom_provider:opencode-go/deepseek-v4.1-flash` for a single `bari exec` run). `--context`, `--max-output`, and `--effort` declare model metadata; without them the runtime falls back to conservative defaults (for example, a 200k context window instead of the model's real one).

In PowerShell, capture the key with the `Read-Host` pattern above and use `$env:OPENCODE_API_KEY`. Requests to `https://opencode.ai/zen/go` automatically carry a per-conversation session header and a `Bari` user agent, so the provider only needs the key. The `/provider` wizard lists OpenCode Go with the pinned model catalog, including `deepseek-v4.1-flash`.

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
