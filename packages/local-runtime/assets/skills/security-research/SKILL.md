---
name: security-research
description: >-
  Conduct authorized, evidence-driven bug bounty and reverse-engineering research over local source,
  binaries, firmware, applications, and public target documentation. Use when the user asks to scope,
  map, hunt, validate, de-duplicate, reproduce, or report a security finding. Do not use for ordinary
  code review, generic debugging, or work whose target authorization is unclear.
---

# Security Research

Turn an authorized target into a reviewable chain from exact artifact to reportable impact. Preserve
the user's research history and keep leads, validated conditions, and demonstrated impact distinct.

## Start from a bounded campaign

Before a broad hunt, establish the facts that affect every conclusion:

- authorized target and actions;
- exact version, build, package, commit, image, or file hash;
- named local roots and external sources that are in scope;
- excluded systems, destructive actions, and runtime constraints;
- program rules, known-issue or freeze lists, and the relevant duplicate corpus;
- fresh output location and time budget.

Use `UNKNOWN` for missing facts. Do not silently expand from one repository, device, VM, directory,
account, or version into another. Keep existing reports and artifacts immutable unless the user asks
to revise them.

Read [references/local-research.md](references/local-research.md) when locating evidence across a
computer or mixed local/browser sources. Read [references/evidence-contract.md](references/evidence-contract.md)
when validating a candidate or deciding whether it is reportable. Read
[references/android-research.md](references/android-research.md) for Android apps, firmware, Binder,
JNI/native code, or device testing. Read [references/reporting.md](references/reporting.md) when
preparing a disclosure or handoff.

## Map before hunting

Build enough execution context to judge findings:

1. Identify entry points, actors, privileges, trust boundaries, persistent state, and security checks.
2. Follow external input to its privileged consumer. Record caller constraints and callee guarantees.
3. State the invariant that would need to fail and the attacker capability required to reach it.
4. List unresolved links instead of bridging them with assumptions.

Prefer a narrow surface with a reasoned attack path over a large list of suspicious strings. Static
decompiler output is source-reference evidence; use canonical source, assembly, smali/DEX, runtime
traces, or a controlled reproducer when semantic behavior matters.

## Advance one evidence level at a time

Use these labels consistently:

- `lead`: interesting signal with no complete attacker-controlled path;
- `candidate`: plausible violated invariant with important links still unverified;
- `validated-condition`: full data flow and boundary failure established for the exact target;
- `demonstrated-impact`: a safe reproducer realizes the claimed security effect;
- `reportable`: demonstrated impact, affected scope, duplicate review, and disclosure evidence are ready;
- `duplicate-or-known`: the same root cause and security boundary are already covered;
- `UNKNOWN`: the available evidence cannot settle the claim.

Never promote a candidate because a scanner assigned high confidence, a function is dangerous in
isolation, a crash occurred, or a decompiler produced readable pseudocode.

## Validate and challenge

For a concrete candidate, verify attacker control, transformations, caller restrictions, the final
consumer, environmental protections, and realized impact. Use a positive case plus a nearby negative
control. Freeze the exact inputs and save commands, logs, hashes, and outputs under a new run root.

Compare potential duplicates by root cause, violated boundary, primitive, affected versions, and
impact. Matching keywords or endpoints are discovery leads, not duplicate proof. Patch diffs and
newer releases can reveal siblings, incomplete fixes, or a non-applicable historical report.

Prefer static and read-only work first. Cross into execution, devices, VMs, accounts, fuzzing, or
state-changing tests only within the user's authorization and with proportionate containment. Stop
when a required authority, target, build, or safety boundary is missing.

## Use agents as independent checks

When delegation is available and the task benefits from it, give workers disjoint questions such as
surface mapping, caller/data-flow validation, duplicate research, or report review. Give each worker
the same frozen target identity and scope. Do not count several agents repeating the same assumption
as corroboration. The lead agent must inspect the evidence and resolve conflicts before accepting a
finding.

## Use the native campaign ledger when available

When the runtime exposes `research_coordination`, make it the authoritative shared record instead of
keeping campaign state only in chat prose or ad-hoc Markdown:

1. Create a campaign once from the root session with the exact target and authorization scope. Treat
   its `freezeDigest` as the identity every worker must share.
2. Create one hypothesis per root-cause fingerprint. Claim its lease before attaching evidence,
   experiments, or duplicate checks; release the lease before verdict changes or independent review.
3. Register material evidence with SHA-256 and byte count. Runtime re-hashes local references inside
   the frozen roots; a declared digest is not accepted as runtime verification. Use `inference`
   honestly; inference cannot satisfy material evidence gates.
4. When HexCore or Hypotenuse produced a terminal Jobs v1 status, use `ingest-analysis-run` instead
   of manually copying its success flag. Runtime re-hashes the job, status, provenance, root target,
   effective inputs and outputs. `hexcore-job` is stable; `hypotenuse-job` is experimental. A receipt
   records coverage and transformations but never changes the hypothesis verdict. If authoring a
   HexCore job, load `hexcore-jobs` and use its inactive-draft validation and atomic publication flow.
5. Record a controlled experiment separately from its artifacts, including the observed negative
   control and cleanup.
6. Have a different session produce and cite its own evidence before recording a blind independent
   review. Re-review after any hypothesis revision; a stale review cannot promote a finding.
7. Let only the campaign leader change verdicts. The runtime will reject incomplete transitions and
   preserve rejected, unknown, or duplicate work as useful negative evidence.

Agent Teams and the campaign ledger have different jobs: the team board schedules work and reviews
deliveries, while the campaign ledger owns research truth. Put hypothesis IDs in team-task instructions,
link the exact runtime-validated team task to the hypothesis, and never use task completion or team
approval as a substitute for a campaign verdict.

## Finish with a candid verdict

Report the exact target, work performed, evidence produced, verdict, practical impact, duplicate
status, and remaining unknowns. Link claims to artifacts or primary sources. If no reportable issue
was found, preserve useful negative evidence and the next bounded hypothesis without inventing a
finding.
