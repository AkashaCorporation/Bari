import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The extension hook names, read from their single declaration.
 *
 * `packages/agent-runtime/src/types.ts` owns `HOOK_NAMES`; nothing else may
 * restate the list. Reading it here keeps `docs/events.md` and its gate in step
 * with the runtime without a second copy that could drift.
 */
const HOOK_NAMES_SOURCE = "packages/agent-runtime/src/types.ts";

export function readDeclaredHookNames(root) {
  const source = readFileSync(path.join(root, HOOK_NAMES_SOURCE), "utf8");
  const block = /export const HOOK_NAMES = \[([\s\S]*?)\]\s*as const/u.exec(source);
  if (!block) {
    throw new Error(
      `Could not find the HOOK_NAMES declaration in ${HOOK_NAMES_SOURCE}. The event gate cannot verify anything without it, so this is a failure rather than an empty result.`,
    );
  }
  const names = [...block[1].matchAll(/['"]([^'"]+)['"]/gu)].map((match) => match[1]);
  // A parser that silently returns nothing would make every downstream check
  // pass while verifying nothing.
  if (names.length === 0) {
    throw new Error(
      `HOOK_NAMES in ${HOOK_NAMES_SOURCE} parsed to zero names; the gate would be vacuous.`,
    );
  }
  return names;
}

/** Path of the document that must carry one row per declared hook. */
export const EVENTS_DOCUMENT = "docs/events.md";

/**
 * Hooks the host runs itself from the assembled handler arrays instead of
 * binding them to a pi hook field. `registry.ts` collects these into
 * `turnStartHandlers` / `turnEndHandlers` and `local-agent-host.ts` runs them.
 *
 * A declared hook that is neither here nor in `HOOK_MAPPINGS` is never
 * delivered: its handlers would be registered and then silently never called.
 */
export const HOST_RUN_HOOKS = ["turn_start", "turn_end"];

const HOOK_MAPPINGS_SOURCE = "packages/agent-runtime/src/registry.ts";

/** Hook names the registry binds to a pi hook field. */
export function readMappedHookNames(root) {
  const source = readFileSync(path.join(root, HOOK_MAPPINGS_SOURCE), "utf8");
  const block = /const HOOK_MAPPINGS = \[([\s\S]*?)\]\s*as const/u.exec(source);
  if (!block) {
    throw new Error(
      `Could not find HOOK_MAPPINGS in ${HOOK_MAPPINGS_SOURCE}; the delivery check would be vacuous.`,
    );
  }
  const names = [...block[1].matchAll(/event:\s*['"]([^'"]+)['"]/gu)].map(
    (match) => match[1],
  );
  if (names.length === 0) {
    throw new Error(
      `HOOK_MAPPINGS in ${HOOK_MAPPINGS_SOURCE} parsed to zero names; the gate would be vacuous.`,
    );
  }
  return names;
}
