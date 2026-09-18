# Locate and install HexCore

This skill never assumes where HexCore lives. Resolve it in this order:

1. A path the user provided for this task.
2. `HEXCORE_ROOT`, when set and valid.
3. A workspace scan for checkout markers:
   - `.agent/skills/hexcore/SKILL.md`
   - `extensions/hexcore-disassembler/src/automationPipelineRunner.ts`
   - `docs/HEXCORE_AUTOMATION.md`
4. A clone into the workspace, after asking the user:

   ```bash
   git clone --depth 1 https://github.com/AkashaCorporation/HikariSystem-HexCore.git .hexcore
   ```

   Then set `HEXCORE_ROOT` for the session instead of hardcoding the path anywhere.

Run the resolver for a deterministic answer:

```bash
node {{DATA_DIR}}/.builtin-skills/hexcore-jobs/scripts/resolve-hexcore-root.mjs --workspace .
```

The script prints the resolved checkout root and exits non-zero with instructions when nothing is found.

## Packaged app versus source checkout

- The supported packaged workbench is a portable Windows 10/11 x64 build from the releases page: `https://github.com/AkashaCorporation/HikariSystem-HexCore/releases`.
- A source checkout builds the workbench and the `cli/` tree; follow `docs/BUILD_WIN_LOCAL.md` and `docs/DEVELOPMENT.md` in the checkout.
- Automation jobs run through the workbench extension host; the `cli/` tree is a separate Rust surface. Read the contract before assuming either entry point exists.

## Authorization

Only analyze binaries the user owns or is authorized to test (CTF/lab artifacts, in-scope bounty targets, their own software). Ask when authorization is unclear.
