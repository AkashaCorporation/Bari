<p align="center">
  <img src="Bari.png" alt="Bari - an AkashaCorporation harness" width="720">
</p>

<h1 align="center">Bari</h1>
<p align="center">An AI agent harness for software work, built for security research and reverse engineering.</p>
<p align="center">
  <a href="#quick-start">Get started</a> |
  <a href="docs/README.md">Documentation</a> |
  <a href="docs/examples.md">Examples</a> |
  <a href="CONTRIBUTING.md">Contributing</a>
</p>
<p align="center"><strong>English</strong> | <a href="README_ZH.md">Chinese</a></p>
<p align="center">
  <img src="docs/assets/node.svg" alt="Compatibility: Node.js 22.19+, 24.2+, 25, and 26">
  <a href="LICENSE-STATUS.md"><img src="docs/assets/license.svg" alt="First-party default license: MIT"></a>
  <a href="https://www.npmjs.com/package/@akashacorporation/bari"><img src="https://img.shields.io/npm/v/@akashacorporation/bari" alt="npm version"></a>
</p>

Bari is AkashaCorporation's terminal agent harness. It started as a fork of MiniMax Code and diverges toward one goal: a coding agent that is a first-class tool for **legitimate cybersecurity and reverse-engineering work**. Bring your own model or use an OpenCode Go subscription, and work with an agent team that already knows the trade.

[![Bari TUI preview: a coding task with failing tests fixed and passing](docs/assets/tui-demo.png)](docs/demo.md)

## Agent team

Four built-in specialists ship with Bari. Every session can delegate to them through `task`; they resolve by name.

| Agent | Use it for |
| --- | --- |
| **orion** | Broad or cross-domain work: decompose, route to a specialist, integrate the answer |
| **june** | Compiled C and C++ binaries: disassembly, lifting, decompilation, the HexCore pipeline |
| **vera** | Authorized security hunting: recon, context building, variant analysis, false-positive checks, honest severity |
| **papi** | Android apps, APKs, Gradle builds, the NDK, native libraries inside APKs |
| explore / worker / verifier | The general-purpose read-only mapping, production, and review roles |

Add your own agents under `~/.bari/agents/<name>/agent.md` and they join the same roster.

## Self evolution

Bari learns from its own work. Explicit skills, run from the prompt:

- `/dream` consolidates recent sessions and existing memory into a smaller, truer durable memory (agent-scoped memory lives in the data directory and is available on the command line too).
- `/distill` finds repeated manual workflows in session history and packages them as skills through the existing skill tooling.
- `compose-next` turns a finished task into the suggested next prompt.

Session history is searchable in-turn with the read-only `history` tool, so the agent can ground its claims in what actually happened.

## Quick start

### 1. Install Bari

With **Node.js 22.19+ (22.x), 24.2+ (24.x), 25, or 26**:

```bash
npm install -g @akashacorporation/bari
bari --version
```

To run the latest source instead, follow [Build from source](#build-from-source).

### 2. Bring your own model (recommended)

BYOK does not require a managed login. Set `MCODE_PROVIDER_API_KEY` in your current shell, then add a provider. Replace the example URL and model name with your provider's values:

```bash
bari provider add --name my-provider --base-url https://example.com/v1 \
  --api-format openai-completions --model my-model \
  --api-key-env MCODE_PROVIDER_API_KEY --use
bari
```

Supported API formats: `openai-completions`, `openai-responses`, and `anthropic-messages`. Optional metadata flags (`--context`, `--max-output`, `--effort low,high,max`) declare the model's real limits and reasoning levels; without them the runtime applies conservative defaults. With `--use`, the first model is tested before the provider is saved and selected, so a failed connection saves nothing. `/model` lists every configured model and can refresh a provider's catalog from its `/models` endpoint. See the [model examples](docs/examples.md#2-choose-your-own-model) for environment variable setup, connection checks, and model overrides for a single run. OpenCode Go subscribers can use the pinned preset described in the [OpenCode Go example](docs/examples.md#opencode-go).

<details>
<summary>Managed accounts and Token Plan</summary>

For a mainland China account:

```bash
bari login
```

For a Global account:

```bash
bari login --region global
```

Complete sign-in in your browser, then open `bari` and use `/status` to check your account and `/provider` to choose a model. Run `bari logout` to sign out. Token Plan requires an account with available credits. MiniMax account documentation (one supported provider) lives at [agent.minimax.io/docs](https://agent.minimax.io/docs/cli/quick-start).

</details>

User data is stored in `~/.bari` by default; an existing `~/.minimax-code` profile keeps being used until `~/.bari` exists. Set `BARI_DATA_DIR` to override.

### 3. Run your first task

Open the project you want to work on:

```bash
cd /path/to/your/project
bari
```

Describe your task in the TUI, or submit it directly when you launch Bari:

```bash
bari "Find a failing test, fix the implementation, and run the relevant tests."
```

Use `bari init .` to generate or update project guidance in `AGENTS.md`. Describe the expected result, allowed changes, and how to verify the task.

| Entry point | Command | Use it for |
| --- | --- | --- |
| Interactive TUI | `bari [prompt]` | Explore code, continue a conversation, and review changes or permissions. |
| Headless | `bari exec [prompt]` | Shell scripts, CI, batch work, and evaluations. |
| ACP | `bari acp` | Editors and clients supporting Agent Client Protocol. |

### Continue your work

```bash
# Resume the latest session in the current workspace
bari --continue

# Open the session picker
bari --session
```

Inside the TUI, use `/sessions` to find previous sessions and `/help` to see all commands and shortcuts.

| Action | Shortcut |
| --- | --- |
| Send a message or steer the running task | `Enter` |
| Queue a follow-up while a task is running | `Alt+Enter` |
| Insert a newline | `Shift+Enter` |
| Reference a workspace file or directory | `@` |
| Toggle Plan Mode | `Shift+Tab` |
| Switch permission modes | `Alt+M` |
| Close a panel or interrupt a running task | `Esc` |

## What you can do

| Task | Capabilities |
| --- | --- |
| **Edit and verify code** | Read files, inspect diffs, run shell commands and tests, and control tool execution with permissions and sandboxing. |
| **Work a target safely** | Ground claims in tool results, validate findings as true or false positives, and keep proofs of concept reversible and scoped. |
| **Choose your model** | Custom OpenAI- or Anthropic-compatible providers, an OpenCode Go subscription, or managed accounts. |
| **Search and work with media** | Use built-in search, embedded media tools, MCP, and managed connectors, subject to account access and service credits. |
| **Keep work moving** | Resume sessions, plan tasks, delegate to the agent team, and extend the harness with plugins and skills. |
| **Connect your workflow** | Run scripted tasks with the headless CLI, or connect compatible editors and clients through ACP. |

Account features, updates, feedback, and diagnostics are also included. Managed tools require network access and the relevant authorization. See [capabilities and service boundaries](docs/tui-capabilities.md) for details.

## Try it

Start the TUI in a copy of the example project and enter:

> Read clamp.mjs and clamp.test.mjs. Run node --test to reproduce the failure, fix clamp without changing the tests, then run the tests again.

The [small, reproducible project](examples/clamp) is the same task used in the demo above. [More examples](docs/examples.md) cover switching models, calling real search, and using your own image inputs.

## Build from source

To develop Bari or run this source checkout, you need Git, **Node.js 22.19+ (22.x), 24.2+ (24.x), 25, or 26**, and **pnpm 9.12.0**.

```bash
git clone https://github.com/AkashaCorporation/Bari.git
cd Bari
pnpm install --frozen-lockfile
pnpm build
pnpm bari
```

The first build requires an internet connection. Dependencies and the integrity-checked embedded tools bundle come from public npm. See the [source installation guide](docs/installation.md) for pnpm setup, system dependencies, and updates.

From the source directory, use `pnpm bari` in place of `bari` in the examples above. To work on your own project, open its directory and launch the built CLI:

```bash
node /absolute/path/to/Bari/dist/cli.js
```

Bari diverges from the MiniMax Code upstream and still tracks its source baseline for third-party synchronization; see the [source sync](docs/source-sync.md) and [version and evidence baseline](docs/open-source-status.md#version-and-evidence-baseline) records. Installing the upstream published package and building this checkout are separate paths.

## Documentation and contributing

- [Installation and updates](docs/installation.md) | [Examples](docs/examples.md) | [TUI status line](packages/tui/docs/status-line-config.md)
- [Contributor guide](CONTRIBUTING.md) | [Report a bug or propose an idea](https://github.com/AkashaCorporation/Bari/issues/new/choose) | [Report a security issue](SECURITY.md)
- [All documentation](docs/README.md): architecture, capability coverage, verification records, source synchronization, and release preparation.

English is the primary documentation language. The [Chinese README](README_ZH.md) mirrors this page.

For now, code and documentation pull requests are accepted only from repository collaborators. If you are not a collaborator but have an idea or proposal, please [open an issue](https://github.com/AkashaCorporation/Bari/issues/new/choose) so we can discuss it. Remove secrets, account details, and private project content from reports.

## Support

This repository hosts issue reporting for Bari. The published source covers the terminal TUI, headless CLI, and ACP. For a CLI bug, include `bari --version`, your interface, and a minimal reproduction. Remove credentials and private project content from reports. [Report a problem or ask a question](https://github.com/AkashaCorporation/Bari/issues/new/choose).

## License and attribution

First-party code defaults to [MIT](LICENSE). Existing file-level and package-level licenses remain in place. Bari is a fork of [MiniMax Code](https://github.com/MiniMax-AI/minimax-code); the `compose-next`, `dream`, and `distill` skills are adapted from [MiMo Code](https://github.com/XiaomiMiMo/MiMo-Code). See [third-party notices](THIRD_PARTY_NOTICES.md) and [license status](LICENSE-STATUS.md) for dependencies, assets, and `mcode-tools`.

Bari is intended for legitimate security research, defensive work, and reverse engineering on authorized targets. Authorized-scope discipline is part of the built-in agent training; keep it that way in yours.
