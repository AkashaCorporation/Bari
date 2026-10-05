/**
 * Every executable this build emits, and the class it belongs to.
 *
 * A class is what makes "does this path bypass the product launcher?" a
 * question with an answer. Before this existed the entry list lived inline in
 * `scripts/build.mjs` and the launcher path was written by hand in
 * `package.json`, so the two could disagree without any gate noticing.
 *
 * - `application` — launched by a user or an agent as the product. Exactly one
 *   entry may carry this class, and it is the only path the root launch scripts
 *   may name.
 * - `worker` — started by the application in-process, never as an entry point.
 * - `tool-cli` — a sibling CLI reached through its own launcher in
 *   `internal-bin`, not through the product launcher.
 * - `host-plugin` — a stdio endpoint a host process starts explicitly.
 */
export const ENTRYPOINT_CLASSES = [
  "application",
  "worker",
  "tool-cli",
  "host-plugin",
];

export const ENTRYPOINTS = {
  cli: {
    className: "application",
    source: "packages/tui/src/index.ts",
  },
  "image-preview-worker": {
    className: "worker",
    source: "packages/tui/src/host/image-preview-worker.ts",
  },
  "mcode-tools": {
    className: "tool-cli",
    source: "packages/tui/src/cli/mcode-tools-entry.ts",
  },
  "matrix-mcp-stdio": {
    className: "host-plugin",
    source: "packages/agent-tools/src/desktop/matrix-mcp-stdio.ts",
  },
};

/** Build output directory, relative to the repository root. */
export const OUTPUT_DIR = "dist";

/** The application entry's emitted path; the root launch scripts must name it. */
export const APPLICATION_LAUNCHER = `${OUTPUT_DIR}/${nameOfApplicationEntry()}.js`;

/** Root package scripts that start the product for a user or an agent. */
export const PRODUCT_LAUNCH_SCRIPTS = ["start", "mcode", "bari"];

function nameOfApplicationEntry() {
  const names = Object.entries(ENTRYPOINTS)
    .filter(([, entry]) => entry.className === "application")
    .map(([name]) => name);
  if (names.length !== 1) {
    throw new Error(
      `Exactly one application entry is allowed; found ${names.length}: ${names.join(", ") || "none"}`,
    );
  }
  return names[0];
}
