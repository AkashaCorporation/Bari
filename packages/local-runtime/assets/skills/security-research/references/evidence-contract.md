# Evidence Contract

Evaluate a finding as a chain. A missing link stays explicit.

## Required links

1. **Exact target** — build/version/hash and configuration relevant to the path.
2. **Attacker position** — identity, privileges, network/process boundary, and prerequisite access.
3. **Controlled input** — exact field, bytes, object, file, message, callback, or state the attacker
   controls.
4. **Transformations** — validation, normalization, serialization, copying, parsing, or routing between
   the source and sink.
5. **Privileged consumer** — the operation that crosses a security boundary.
6. **Constraints and protections** — callers, ACLs, sandboxing, signatures, integrity levels, feature
   flags, deployment defaults, and platform mitigations.
7. **Realized effect** — observable confidentiality, integrity, availability, authorization, isolation,
   or trust-boundary impact.
8. **Negative control** — a nearby input or state that should not trigger the effect.
9. **Reproduction quality** — bounded steps, stable artifacts, cleanup, and repeatability.
10. **Duplicate status** — comparison against the relevant program corpus by root cause and boundary.

## Verdict rules

- Missing attacker control or reachability: `lead` or `UNKNOWN`.
- Reachable unsafe condition without realized security effect: `candidate` or `validated-condition`.
- Crash without boundary impact: record the crash; do not infer code execution or privilege gain.
- Scanner, grep, or decompiler match without a complete chain: `lead`.
- Safe reproducer with positive and negative controls on the exact build: `demonstrated-impact`.
- Report package with exact affected scope and duplicate review: `reportable`.

Confidence describes evidence quality; it does not replace a missing link. Distinguish a tool's
confidence score from the research verdict.

## Evidence table

Use a compact table when handing work between agents or sessions:

| Claim | Status | Evidence | Negative control | Remaining gap |
| --- | --- | --- | --- | --- |
| Attacker controls field X | validated/unknown | artifact or source locator | rejected input Y | exact constraint |
| X reaches privileged sink Z | validated/unknown | call/data-flow path | safe caller/path | missing dynamic edge |
| Z causes impact I | demonstrated/unknown | reproducer and observation | unchanged baseline | deployment breadth |

Keep source evidence, observed behavior, and inference in separate rows when they support different
parts of the chain.
