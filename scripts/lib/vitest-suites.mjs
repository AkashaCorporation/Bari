import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const suitesPath = "test/vitest-suites.json";

export function readSuites(root) {
  return JSON.parse(readFileSync(path.join(root, suitesPath), "utf8")).suites;
}

/**
 * Per-suite scope declarations. A suite with `platforms` only holds files that
 * exercise that platform's semantics; a suite with `explicitOnly` is
 * load-sensitive and belongs to its own gate. Both must stay out of an
 * unscoped local sweep, where they would fail for reasons unrelated to the
 * change under test.
 */
export function readSuiteScopes(root) {
  const { scopes } = JSON.parse(readFileSync(path.join(root, suitesPath), "utf8"));
  return scopes ?? {};
}

function scopeApplies(scope, platform) {
  if (!scope) return true;
  if (scope.explicitOnly) return false;
  if (scope.platforms && !scope.platforms.includes(platform)) return false;
  return true;
}

/**
 * Files of every suite that applies to this platform and to an unscoped run.
 * This is what `vitest.oss.config.mjs` includes, so a bare run stays portable;
 * scoped suites are reached through their named gate instead.
 */
export function defaultSuiteFiles(root, platform = process.platform) {
  const suites = readSuites(root);
  const scopes = readSuiteScopes(root);
  return Object.entries(suites)
    .filter(([name]) => scopeApplies(scopes[name], platform))
    .flatMap(([, files]) => files);
}

export function suiteFiles(root, name) {
  const suites = readSuites(root);
  const files = suites[name];
  if (!files)
    throw new Error(
      `Unknown Vitest suite "${name}"; ${suitesPath} declares ${Object.keys(suites).join(", ")}`,
    );
  return files;
}

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

// Use the source inventory rather than Git so exported source archives enforce
// the same coverage contract. Vendored suites and repository node:test gates
// are deliberately outside the first-party Vitest discovery boundary.
export function suiteInventoryViolations(files, suites) {
  const actual = new Set(files);
  const declared = Object.values(suites).flat();
  const registered = new Set();
  const violations = [];
  for (const file of declared) {
    if (registered.has(file))
      violations.push(`${file}: duplicate Vitest registration`);
    registered.add(file);
    if (!actual.has(file))
      violations.push(`${file}: registered Vitest file is missing`);
  }
  for (const file of files) {
    if (
      file.startsWith("packages/") &&
      /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file) &&
      !registered.has(file)
    )
      violations.push(
        `${file}: first-party test is absent from test/vitest-suites.json`,
      );
  }
  return violations;
}
