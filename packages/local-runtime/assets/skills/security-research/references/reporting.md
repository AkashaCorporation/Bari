# Disclosure and Handoff Reporting

Write for a reviewer who has no access to the conversation. A strong report lets them identify the
exact target, reproduce the behavior safely, understand the violated boundary, and judge impact.

## Core content

- concise title naming the primitive and boundary;
- affected product, version/build/hash, configuration, and environment;
- prerequisite attacker capability and excluded assumptions;
- numbered reproduction steps with a minimal PoC or artifact;
- expected result, observed result, and negative control;
- root-cause data/call flow with source, assembly, or trace locators;
- concrete security impact and its practical limits;
- duplicate search scope and closest prior reports/advisories;
- cleanup/restoration steps and attachment hashes;
- explicit unknowns and confidence.

## Style

Use direct, technical prose. Prefer exact objects, identities, paths, values, and observations over
generic severity language. Do not pad the report with tutorials, repeated conclusions, imagined attack
chains, or praise for the product. Avoid claims such as "fully compromised", "critical", or "arbitrary"
unless the reproduction demonstrates the complete claim.

Separate three kinds of statements:

- **Confirmed source evidence:** what the exact artifact contains.
- **Observed runtime evidence:** what happened in a controlled reproduction.
- **Inference or hypothesis:** what the evidence suggests but has not established.

Do not hide uncertainty to make a report sound stronger. A narrowly demonstrated impact with clear
limits is more credible than a broad speculative claim.

## Handoff

For unfinished work, include target hashes, paths, commands already run, artifacts, current verdict,
failed approaches, safety boundaries, and the next decisive test. State whether each result is
`success`, `partial`, `failed`, `skipped`, or `UNKNOWN`. A handoff must not require access to chat history
to continue safely.
