---
name: hexcore-jobs
description: Run reproducible binary-analysis jobs with HikariSystem HexCore (PE/ELF triage, disassembly, lifting, decompilation, emulation, and evidence reports). Use when the user asks to run a HexCore job, analyze a binary with HexCore, create or validate a `.hexcore_job.json` pipeline, or inspect HexCore artifacts and provenance. Do not use for generic binary or PE parsing when HexCore is not requested or not available; use web_fetch or native tools instead.
---

# HexCore Jobs

Drive HexCore's automation pipeline for authorized binary analysis. This skill never assumes a machine-specific install path: it resolves the local checkout (or clones the public repository with the user's confirmation) and then follows the canonical contract that HexCore ships in its own repository.

Analyze only binaries the user owns or is explicitly authorized to analyze. Ask when authorization is unclear.

## Inputs to collect

- Target binary path and the question to answer (triage, decompile a function, emulate an input, extract IOCs, verify a hypothesis).
- Output directory inside the workspace, or a path the user deliberately allows.
- Time budget: native analysis can run for minutes and is killable.

## Locate HexCore (no hardcoded paths)

1. Use a path the user provided.
2. Use `HEXCORE_ROOT` when it points at a checkout.
3. Search the workspace with `node {{DATA_DIR}}/.builtin-skills/hexcore-jobs/scripts/resolve-hexcore-root.mjs --workspace <dir>` for the markers `.agent/skills/hexcore/SKILL.md`, `extensions/hexcore-disassembler/src/automationPipelineRunner.ts`, or `docs/HEXCORE_AUTOMATION.md`.
4. If nothing is found, ask before cloning `https://github.com/AkashaCorporation/HikariSystem-HexCore.git` into a subdirectory of the workspace (shallow clone). Never write outside the workspace and never assume a VS Code install directory.

## Read the canonical contract first

Before authoring or running a job, read from the resolved checkout (preferred, because it matches the installed build) or from `https://raw.githubusercontent.com/AkashaCorporation/HikariSystem-HexCore/main/<path>`:

- `.agent/skills/hexcore/SKILL.md` — engine routing, pipeline-safe commands, job rules.
- `docs/HEXCORE_AUTOMATION.md` — automation reference.
- `docs/HEXCORE_JOB_TEMPLATES.md` — canonical job templates.
- `docs/KNOWN_LIMITATIONS.md` — what a result does not prove.

Do not copy large sections of those documents into the workspace; cite the paths instead.

## Procedure

1. Confirm authorization and keep `outDir` inside the workspace.
2. Inspect available commands and engines (`hexcore.pipeline.listCapabilities` or `hexcore.pipeline.doctor`).
3. Author an inactive `<name>.hexcore_job.draft.json`; never save unvalidated content to a watched `*.hexcore_job.json` path. Chain producers and consumers with `$step[N].output`; keep one job when a step consumes another step's artifact.
4. Run `scripts/validated-job.mjs prepare` to bind the draft hash, intended watched path, validation-report path, and step count. Then invoke the checkout's canonical `hexcore.pipeline.validateJob` with `{ jobFile: <draft>, output: <validation-report>, quiet: true }`.
5. If validation passes, run `scripts/validated-job.mjs publish`. It rejects changed drafts, stale or mismatched reports, path escapes, unsafe outputs, and existing watched files, then publishes the exact validated bytes atomically. Never bypass a preflight failure or hand-copy the draft into place.
6. Let the workspace watcher enqueue the newly published job. If the watcher is disabled, queue it once explicitly; do not combine both paths speculatively.
7. Inspect `.hexcore-pipeline.log` and `.hexcore-pipeline.status.json`. For long native steps, read `.hexcore-meta/*.heartbeat.json` and `nativeExecution.lastPhase` instead of blindly raising deadlines.
8. Verify every artifact against `.hexcore-meta/provenance.json` before comparing runs. Keep `partial` as partial: never report it as complete, and use `allowPartial` only when incomplete coverage is intentional.
9. Report the terminal status (`ok|partial|failed|skipped`), artifact paths, evidence level, and what remains unverified.

## Output contract

- Job files created, the validation result, and the terminal pipeline status.
- The validation-request and publication-receipt paths when a watched job was published.
- Exact artifact paths with their provenance entries.
- Semantic claims labeled `signal`, `candidate`, or `proven` as the contract defines.
- No invented findings: every conclusion points at an artifact the pipeline produced.

## Failure handling

- Validation error: fix the inactive draft, prepare a new request, and re-validate; do not publish or run.
- Timeout: inspect the heartbeat and last phase, raise the deadline once, then stop and report.
- A command disabled by configuration is `skipped`, not a tool failure.
- Missing packaged app or native engine: report the requirement and point to `docs/BUILD_WIN_LOCAL.md` for the source path.
- Never enable `hexcore.pipeline.allowExternalOutDir` or invoke recursive `runJob` on your own.

## Windows (win32) notes

- The packaged workbench targets Windows 10/11 x64. Use the PowerShell recipes from the HexCore docs on Windows and the POSIX recipes elsewhere; do not translate them blindly.
- Quote paths that contain spaces.

## References

- `references/locate-and-install.md` — resolution order, markers, clone and build pointers.
- `references/job-workflow.md` — validate, run, inspect, and provenance flow.
- `references/troubleshooting.md` — native engine, timeout, partial, and provenance issues.
