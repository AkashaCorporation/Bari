# Install from source

Bari is distributed as source. The upstream MiniMax Code CLI is published as [`@minimax-ai/code`](https://www.npmjs.com/package/@minimax-ai/code); installing that package does not install Bari. Follow the steps below to build this checkout.

For a source build, you need Git, Node.js 22.19+ (22.x), 24.2+ (24.x), 25, or 26, and pnpm 9.12.0. Regular CI uses Node.js 24 across Linux, macOS, and Windows. Initial installation and build require access to public npm.

Node 24.0 and 24.1 are unsupported: their bundled libuv can return inconsistent Windows file identity metadata, causing safe configuration reads to fail. [Node 24.2.0](https://nodejs.org/en/blog/release/v24.2.0) includes libuv 1.51.0 with the [upstream fix](https://github.com/libuv/libuv/commit/82cdfb75f). Use a current patch release of a supported Node line.

```bash
git clone https://github.com/AkashaCorporation/Bari.git
cd Bari
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm bari --help
pnpm bari
```

If your Node.js installation does not include Corepack, install the exact pnpm version using your existing package manager. Native dependencies without matching prebuilt binaries require C/C++ build tools and Python: the C++ workload in Visual Studio Build Tools on Windows, Command Line Tools on macOS, or the system build toolchain on Linux.

A working native SQLite binding is required at runtime. `pnpm install` builds `better-sqlite3` for the current platform; do not disable dependency installation scripts. The build extracts `mcode-tools` from a pinned public `@minimax-ai/code` archive and verifies both archive and CLI hashes. The cache is in `.cache/artifacts`. On integrity failure, check the network or remove that cache and retry; never bypass hash verification.

To use the CLI in another project, open that project's directory and run the built entry point by absolute path:

```bash
node /absolute/path/to/Bari/dist/cli.js
```

On Windows, also use `node` with the appropriate local absolute path. Do not overwrite another globally installed command with this source build.

## Accounts and data

Run `/login` in the TUI or `pnpm bari login`, choosing the region for your account. Token Plan requires an account and available credits. See the root README for BYOK configuration and testing.

The default data directory is `~/.minimax-code`, inherited from the upstream baseline; a future release will introduce `~/.bari` with migration. For tests, explicitly set `MINIMAX_DATA_DIR` to a temporary directory to keep normal sessions separate. Use `$env:MINIMAX_DATA_DIR = 'C:\path\to\test-profile'` in PowerShell or `export MINIMAX_DATA_DIR=/path/to/test-profile` in a POSIX shell.

## Update or remove

Save your changes, fetch a reviewed revision with Git, then repeat the frozen install and build. A source installation does not automatically become an upstream npm installation.

To uninstall, remove the source directory you created. User data is separate and remains in place. Delete that directory only when you no longer need its account configuration or sessions.
