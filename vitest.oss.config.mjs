import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readExtraction } from "./scripts/lib/release-metadata.mjs";
import { packageExportEntries } from "./scripts/lib/package-exports.mjs";
import { defaultSuiteFiles, suiteFiles } from "./scripts/lib/vitest-suites.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const { packageRoots } = readExtraction(root);
// `run-vitest-suite.mjs <suite>` selects one group explicitly. Its files are the
// include for that run, because positional arguments only filter what the
// include already admits; scoped suites are otherwise absent from the default
// sweep by design.
const requestedSuite = process.env.VITEST_SUITE?.trim();
const alias = packageExportEntries(root, packageRoots).map(
  ({ specifier, file }) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: path.join(root, file),
  }),
);
export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    // Scoped suites (other platforms, load-sensitive) are reached through their
    // named gate; including them here made a local run fail for reasons
    // unrelated to the change under test.
    include: requestedSuite ? suiteFiles(root, requestedSuite) : defaultSuiteFiles(root),
  },
});
