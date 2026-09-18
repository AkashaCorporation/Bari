# Troubleshooting

## Nothing resolves

- Set `HEXCORE_ROOT` to the checkout, or clone it inside the workspace and rerun the resolver.
- Confirm the markers exist (`.agent/skills/hexcore/SKILL.md`, `extensions/hexcore-disassembler/src/automationPipelineRunner.ts`, `docs/HEXCORE_AUTOMATION.md`).

## Commands are missing or skipped

- Run `hexcore.pipeline.listCapabilities` (or `hexcore.pipeline.doctor`) and compare with the contract's command list; commands change between releases.
- A command disabled by configuration (`hexcore.emulator`, feature gates) reports `skipped`; that is not a tool failure.
- Preview commands gated behind a preview flag must not back a stable-release job.

## Timeouts

- Native analysis is killable: inspect `.hexcore-meta/*.heartbeat.json` and `nativeExecution.lastPhase` to see whether progress is real.
- Raise a deadline once with justification; if it still times out, stop and report instead of retrying in a loop.
- For crash or timeout investigations on decompilation, the contract supports retaining the lifted IR; use it instead of rerunning blindly.

## Partial and failed status

- `partial` means incomplete coverage. Keep it visible and state which steps produced evidence.
- Validation failures must be fixed, not bypassed.
- Recursive `runJob` is blocked by design; restructure the job.

## Provenance

- Verify each artifact against `.hexcore-meta/provenance.json` before cross-run comparison.
- Findings and semantic claims carry stable IDs; do not merge results from different targets or sessions as if they were one run.
- Read `docs/KNOWN_LIMITATIONS.md` before treating an analysis as complete, and report which limitation applies.
