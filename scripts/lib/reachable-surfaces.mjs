/**
 * Which source modules the standalone distribution must actually reach.
 *
 * A module can exist, be exported, be tested, and still contribute nothing to
 * the product: esbuild resolves it because something imports it, then drops it
 * because nothing emitted calls it. That is how a team surface with passing
 * tests turned out to be unreachable from the shipped CLI, and no test could
 * have said so.
 *
 * `check:reachability` reads the build metafile and asserts both directions:
 * every module under `mustBeReachable` contributed bytes to an output, and
 * every module under `knownUnreachable` did not. The second list is not
 * decoration — it records a deliberate boundary, so wiring one of them later
 * fails the gate and forces the list to be updated on purpose.
 *
 * Add a module to `mustBeReachable` when you add a product surface. If the gate
 * fails, the surface is not in the product, whatever its tests say.
 */
export const MUST_BE_REACHABLE = [
  // The standalone product entry and its runtime facade.
  { path: 'packages/tui/src/index.ts', owns: 'the standalone CLI entry' },
  {
    path: 'packages/local-runtime-v2/src/local/cli-service.ts',
    owns: 'the runtime facade the TUI talks to',
  },
  {
    path: 'packages/local-runtime-v2/src/services.ts',
    owns: 'runtime service composition',
  },
  // Product surfaces the TUI reaches through ports.
  {
    path: 'packages/tui/src/runtime/adapters/delegation-access.ts',
    owns: 'the delegated-agent view, roles, message delivery and stop control',
  },
  {
    path: 'packages/tui/src/runtime/delegation.ts',
    owns: 'the team membership and role derivation',
  },
  {
    path: 'packages/tui/src/acp/extensions.ts',
    owns: 'the ACP extension surface, including bari/session/delegation/get and /stop',
  },
  {
    path: 'packages/tui/src/acp/agent.ts',
    owns: 'the ACP update notifications, including bari/session/delegation_update',
  },
  {
    path: 'packages/tui/src/runtime/adapters/product-access.ts',
    owns: 'the TUI runtime port implementation',
  },
  {
    path: 'packages/tui/src/cli/config-command.ts',
    owns: 'bari config dump',
  },
  {
    path: 'packages/tui/src/tui/features/model/pricing.ts',
    owns: 'the zero-cost model badge',
  },
  {
    path: 'packages/local-runtime-v2/src/service/automation/coordinator.ts',
    owns: 'automatic learning admission',
  },
  {
    path: 'packages/local-runtime-v2/src/service/session-system/usage/request-ledger.ts',
    owns: 'durable model attempt accounting',
  },
];

/**
 * Surfaces this distribution deliberately does not reach.
 *
 * The v1 host's HTTP route table is not mounted by the standalone entry: the
 * product talks to its runtime through ports, not routes. A consumer outside
 * this distribution may still call it, which is why it stays rather than being
 * deleted — but nothing here may add product behaviour to it.
 */
export const KNOWN_UNREACHABLE = [
  {
    path: 'packages/local-runtime/src/team/api.ts',
    reason:
      'the v1 team route surface is not mounted by the standalone entry; the product team view is derived from sessions in the TUI delegation port',
    // A module can be partly emitted: this one contributes only its ownership
    // helper. Reachability of the route surface is asserted by a string literal
    // that only that surface contains, so the check measures the surface rather
    // than the file.
    absentMarker: '/team/plan',
  },
];
