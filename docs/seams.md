# Capability seams

A **seam** is a swappable capability with three roles:

1. a **Service Definition** declaring the interface,
2. at least one **Service Provider** implementing it,
3. at least one **Consumer** using it.

A package may fill more than one role, but **a role standing alone is not a
seam**. A definition nobody implements is a plan; a provider nobody consumes is
dead weight. `scripts/check-seams.mjs` fails on either, and on a declared role
whose file does not actually import the definition — a provider can implement a
shape by accident, and that accident is invisible until someone swaps it.

The seams this distribution declares are in
[`scripts/lib/capability-seams.mjs`](../scripts/lib/capability-seams.mjs), which
is also where each one states **what changes for the whole product when its
provider is swapped**. Writing that down is the point of the list: a seam whose
swap changes nothing visible is either misnamed or unnecessary.

## Why this is a gate and not a convention

The three failure modes this catches are all silent:

- a definition with no provider, left behind after a refactor moved the
  implementation;
- a provider nobody consumes, which still compiles and still passes its own
  tests;
- a provider that implements a shape without naming the definition, so a change
  to the definition breaks it at runtime rather than at build time.

None of them fails a build, and none of them fails a test that passes today.
Each is only visible in the relationship between files, which is what the gate
checks.

## Reading a seam

For each declared seam, ask what a provider swap would move. The declared
`capability` field is the answer that was true when the seam was added; if it is
no longer true, the seam changed shape and the entry needs updating rather than
deleting.

The session substrate seams are worth knowing together, because they compose:

| Seam | Swap changes |
| --- | --- |
| `message-repository` | every reader of committed session history |
| `session-stream-writer` | every live surface following a session |
| `canonical-history-file-adapter` | what every history reader and mutation path sees, including replay identities |
| `session-source-query` | what source views return, not who requests them |
| `sandbox-backend` | which platform can confine anything at all |

## Adding a seam

Add a capability by designing all three roles, then declare them:

1. Write the definition as a type or interface with no implementation.
2. Add a provider that imports the definition and returns it from its factory.
3. Add a consumer that uses the capability — through the definition type or
   through the provider wired at composition, both count.
4. Add an entry to `CAPABILITY_SEAMS` with the path of each role and a
   `capability` sentence saying what a swap changes.
5. `node scripts/check-seams.mjs` must pass.

## Limits of the check

- Only relative import specifiers are resolved. A provider importing the
  definition through a barrel or a package alias is reported as not importing
  it; declare a file that names the definition directly, or add the import.
- Dynamic `import()` is not matched. A role that loads the definition at runtime
  cannot be verified here.
- The gate proves the roles are connected, not that the provider is a good
  implementation. Review still has to look at the code.