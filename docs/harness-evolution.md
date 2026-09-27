# Harness evolution

Status: in progress. Baseline: `f740ef250523a4a1dd87dd30d7586d8f8de321ea`.

## Delivery contract

- Integrate MiniMax #304, #290, #287, #314 and #367 with their required public
  dependencies. Preserve Bari adaptations and the reviewed source boundaries.
- Automatically select Compose Next for qualifying development tasks. Keep
  simple requests lightweight and preserve explicit user workflow overrides.
- Automatically schedule bounded Dream and Distill work after useful completed
  work, without recursive maintenance, duplicate scheduling or blocking user
  turns. Provide configuration to disable each workflow and limit its cost.
- Validate learned content against its source, isolate learning from evaluation
  answers, and retain operation-level provenance and rollback for memory/skills.
- Expose reported token usage for the primary agent, delegated agents and the
  aggregate in the TUI. Preserve unknown/incomplete status and avoid double
  counting retries, resumed sessions or replayed events. Include maintenance cost.
- Improve terminal presentation without reducing narrow-terminal, keyboard or
  existing status-line customization support.
- Add repeatable synthetic evaluations for lifecycle, learning and delegation,
  plus an opt-in live-model evaluation protocol with separate learning/held-out
  cases. Report offline results separately from live-model quality.
- Assess further structured HexCore integration from actual harness boundaries;
  do not claim specialized quality improvements without paired measurements.

## Verification

Each implementation stage runs its affected regression tests. The integrated
tree must pass `pnpm verify` on Windows. Platform-inapplicable tests remain
explicitly skipped. Live providers, other operating systems and HexCore quality
benchmarks require separate evidence and are not implied by synthetic tests.

## Progress

- [ ] Public fixes and dependencies, including Windows runtime verification.
- [ ] Automatic Compose Next admission.
- [ ] Automatic Dream/Distill scheduling and bounded execution.
- [ ] Learning provenance, validation and rollback.
- [ ] Primary/delegated/maintenance token accounting and TUI presentation.
- [ ] Repeatable evaluations and live-model protocol.
- [ ] Full verification and independent source review.
- [ ] HexCore integration assessment and delivery record.

The original working tree is preserved separately. Development commits use the
repository-local author configuration; imported code provenance is recorded in
[the selective integration record](source-sync-0.5.5.md).
