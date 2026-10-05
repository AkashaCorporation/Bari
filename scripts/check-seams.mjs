import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CAPABILITY_SEAMS } from "./lib/capability-seams.mjs";

// A capability seam is a definition, at least one provider and at least one
// consumer, and the roles have to be connected, not merely present side by
// side. Declaring file paths and checking that they actually import the
// definition is what distinguishes a seam from a plan.
//
// Imports are resolved against the file system rather than matched as text:
// sources import './x.js' for a file that is 'x.ts', so a textual comparison
// misses same-directory imports and reports an implementation as absent. That
// mistake is what this gate exists to avoid repeating.
const root = fileURLToPath(new URL("../", import.meta.url));
const violations = [];

const toRepoPath = (absolute) => path.relative(root, absolute).split(path.sep).join("/");

const importSpecifiers = (source) =>
  [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/gu)].map((match) => match[1]);

/** Resolve a relative specifier to the source file it names, or undefined. */
function resolveRelative(fromFile, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const joined = path.resolve(path.dirname(path.join(root, fromFile)), specifier);
  const asSource = joined.replace(/\.js$/u, ".ts");
  return toRepoPath(asSource);
}

function readsFrom(file, target) {
  if (!existsSync(path.join(root, file))) return false;
  const source = readFileSync(path.join(root, file), "utf8");
  return importSpecifiers(source).some((specifier) => resolveRelative(file, specifier) === target);
}

for (const seam of CAPABILITY_SEAMS) {
  const label = seam.key;
  if (!seam.capability || seam.capability.trim().length === 0) {
    violations.push(`${label}: declares no capability, so nothing says what a provider swap changes`);
  }
  if (!existsSync(path.join(root, seam.definition))) {
    violations.push(`${label}: definition is missing (${seam.definition})`);
    continue;
  }

  if (!Array.isArray(seam.providers) || seam.providers.length === 0) {
    violations.push(
      `${label}: declares no provider; a definition nobody implements is a plan, not a seam`,
    );
  }
  for (const provider of seam.providers ?? []) {
    if (!existsSync(path.join(root, provider))) {
      violations.push(`${label}: provider is missing (${provider})`);
      continue;
    }
    if (!readsFrom(provider, seam.definition)) {
      violations.push(
        `${label}: provider ${provider} does not import the definition; it implements a shape by accident`,
      );
    }
  }

  if (!Array.isArray(seam.consumers) || seam.consumers.length === 0) {
    violations.push(
      `${label}: declares no consumer; a provider nobody uses is dead weight`,
    );
  }
  for (const consumer of seam.consumers ?? []) {
    if (!existsSync(path.join(root, consumer))) {
      violations.push(`${label}: consumer is missing (${consumer})`);
      continue;
    }
    // A consumer usually uses the capability through the wired provider (a
    // factory call at composition) rather than the definition type, so both
    // count as consumption.
    const consumes =
      readsFrom(consumer, seam.definition) ||
      (seam.providers ?? []).some((provider) => readsFrom(consumer, provider));
    if (!consumes) {
      violations.push(
        `${label}: consumer ${consumer} imports neither the definition nor a declared provider`,
      );
    }
  }
}

if (violations.length) {
  throw new Error(`Capability seam check failed:\n${violations.join("\n")}`);
}
console.log(
  `Capability seam check passed: ${CAPABILITY_SEAMS.length} seams, each with a definition, a provider and a consumer.`,
);