# Job workflow

Read the canonical contract in the resolved checkout before using this summary: `.agent/skills/hexcore/SKILL.md`, `docs/HEXCORE_AUTOMATION.md`, and `docs/HEXCORE_JOB_TEMPLATES.md`. Treat prose examples as examples; the pipeline runner is the source of truth.

## Authoring rules (from the contract)

- Job file: `.hexcore_job.json` or a descriptive `*.hexcore_job.json` in the workspace.
- Keep `outDir` inside the workspace or the job-file directory unless the user deliberately enables external output.
- Chain artifacts with `$step[N].output`. `$step[prev]` is invalid in step `0`; forward references are invalid. Validation reports conditional jumps that may skip a referenced producer.
- Top-level `continueOnError` is inherited by steps unless a step overrides it.
- Set realistic timeouts. `analyzeAll` runs in a killable child process; a timeout must terminate the worker and reach a terminal status.
- Do not call `hexcore.pipeline.runJob` from inside a pipeline step; recursive execution is blocked.
- Preflight validation is mandatory. Never bypass it to obtain a partial artifact.
- Semantic child failures fail by default. Use `allowPartial: true` only when incomplete coverage is intentional, and keep the terminal `partial` status visible.

## Running and inspecting

1. `hexcore.pipeline.validateJob` or `hexcore.pipeline.validateWorkspace` before expensive work.
2. `hexcore.pipeline.queueJob` (or the workspace watcher) to run; `hexcore.pipeline.jobStatus` and `hexcore.pipeline.cancelJob` manage it.
3. Inspect `.hexcore-pipeline.log` and `.hexcore-pipeline.status.json`: attempts, output bytes, totals, slowest step, and the queue snapshot.
4. Long native steps: check `.hexcore-meta/*.heartbeat.json` and `nativeExecution.lastPhase` before changing a timeout.
5. Verify artifacts in `.hexcore-meta/provenance.json` before any cross-run comparison. New jobs do not emit visible per-artifact sidecars.

## Queue and watcher behavior

- Root-level canonical and named jobs are auto-discovered on startup; the recursive watcher reacts to later changes under the workspace.
- A stale unchanged `running` status is archived and terminalized after the configured stale window, then the revision may run again.
- Queue parallel slots are configurable; stateful jobs serialize across the extension host. Use `sessionId` for sticky routing when jobs share a keep-alive emulation session.

## Reporting

Report the terminal status (`ok|partial|failed|skipped`), the artifact paths, the evidence level for semantic claims, and remaining uncertainty. Never present `partial` or `skipped` output as complete. Preserve session/generation identifiers and hashes from provenance when summarizing.
