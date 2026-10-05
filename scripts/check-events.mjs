import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVENTS_DOCUMENT,
  HOST_RUN_HOOKS,
  readDeclaredHookNames,
  readMappedHookNames,
} from "./lib/extension-events.mjs";

// Three failure modes are worth a gate, and none of them is visible in a
// passing test suite:
//   1. a declared hook that no document explains,
//   2. a hook nothing delivers, so its handlers are registered and never run,
//   3. a document row for a hook that no longer exists.
const root = fileURLToPath(new URL("../", import.meta.url));
const declared = readDeclaredHookNames(root);
const mapped = new Set(readMappedHookNames(root));
const hostRun = new Set(HOST_RUN_HOOKS);
const violations = [];

// Every declared hook must be delivered by exactly one mechanism.
for (const name of declared) {
  const onMapping = mapped.has(name);
  const onHost = hostRun.has(name);
  if (!onMapping && !onHost) {
    violations.push(
      `${name}: declared but not delivered; add it to HOOK_MAPPINGS or to HOST_RUN_HOOKS`,
    );
  }
  if (onMapping && onHost) {
    violations.push(
      `${name}: delivered by both a pi mapping and the host; pick one mechanism`,
    );
  }
}

// The document must carry one row per declared hook, and no rows for anything
// else. Only the hook map section is read: the observer table further down
// lists a different kind of extension point and its rows must not be mistaken
// for hooks.
const document = readFileSync(path.join(root, EVENTS_DOCUMENT), "utf8");
const section = /^## Hook map$([\s\S]*?)(?=^## |(?![\s\S]))/mu.exec(document);
if (!section) {
  throw new Error(
    `${EVENTS_DOCUMENT}: no "## Hook map" section found; the documentation check cannot locate the rows.`,
  );
}
const documented = new Set(
  [...section[1].matchAll(/^\|\s*`([^`]+)`\s*\|/gmu)].map((match) => match[1]),
);
if (documented.size === 0) {
  throw new Error(
    `${EVENTS_DOCUMENT}: parsed zero event rows; the documentation check would be vacuous.`,
  );
}
for (const name of declared) {
  if (!documented.has(name)) {
    violations.push(`${name}: declared but has no row in ${EVENTS_DOCUMENT}`);
  }
}
for (const name of documented) {
  if (!declared.includes(name)) {
    violations.push(
      `${name}: documented in ${EVENTS_DOCUMENT} but not declared in HOOK_NAMES`,
    );
  }
}

if (violations.length) {
  throw new Error(`Extension event check failed:\n${violations.join("\n")}`);
}
console.log(
  `Extension event check passed: ${declared.length} declared hooks, ${mapped.size} mapped, ${hostRun.size} host-run, all documented.`,
);
