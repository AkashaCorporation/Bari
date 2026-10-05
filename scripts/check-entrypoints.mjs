import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APPLICATION_LAUNCHER,
  ENTRYPOINTS,
  OUTPUT_DIR,
  PRODUCT_LAUNCH_SCRIPTS,
} from "./lib/entrypoints.mjs";

// Every executable this project emits has a declared class, and only the
// application entry may be reached from a root launch script. The check runs
// against the built output because that is what a launcher actually starts; a
// source-level check cannot see a rename between the two.
const root = fileURLToPath(new URL("../", import.meta.url));
const outdir = path.join(root, OUTPUT_DIR);
const violations = [];

if (!existsSync(outdir)) {
  throw new Error(
    `Entry point check requires a build: ${OUTPUT_DIR}/ does not exist.`,
  );
}

// A declared source that no longer exists would silently drop an emitted
// executable while the build still succeeds.
for (const [name, entry] of Object.entries(ENTRYPOINTS)) {
  if (!existsSync(path.join(root, entry.source))) {
    violations.push(`${name}: declared source is missing (${entry.source})`);
  }
}

// Declared outputs must exist and carry code. An entry built to an empty file
// is a launch failure that only shows up when a user runs it.
for (const name of Object.keys(ENTRYPOINTS)) {
  const emitted = path.join(outdir, `${name}.js`);
  if (!existsSync(emitted)) {
    violations.push(`${name}: no emitted artifact at ${OUTPUT_DIR}/${name}.js`);
    continue;
  }
  if (statSync(emitted).size === 0) {
    violations.push(`${name}: emitted artifact at ${OUTPUT_DIR}/${name}.js is empty`);
  }
}

// The emitted entries are the only root-level JavaScript in the output. An
// undeclared one is a second application path, which is what this gate exists
// to reject.
const declaredArtifacts = new Set(
  Object.keys(ENTRYPOINTS).map((name) => `${name}.js`),
);
for (const file of readdirSync(outdir)) {
  if (!file.endsWith(".js")) continue;
  if (!statSync(path.join(outdir, file)).isFile()) continue;
  if (!declaredArtifacts.has(file)) {
    violations.push(
      `${OUTPUT_DIR}/${file}: undeclared build artifact; declare it in scripts/lib/entrypoints.mjs or remove it`,
    );
  }
}

// Root launch scripts are the product's front door. Each must start the
// declared application launcher and nothing else.
const scripts = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).scripts;
for (const name of PRODUCT_LAUNCH_SCRIPTS) {
  const command = scripts[name];
  if (typeof command !== "string") {
    violations.push(`package.json: launch script "${name}" is missing`);
    continue;
  }
  if (!command.includes(APPLICATION_LAUNCHER)) {
    violations.push(
      `package.json: launch script "${name}" does not start ${APPLICATION_LAUNCHER} (${command})`,
    );
  }
}

if (violations.length) {
  throw new Error(`Application entry point check failed:\n${violations.join("\n")}`);
}
console.log(
  `Application entry point check passed: 1 launcher, ${Object.keys(ENTRYPOINTS).length - 1} classified sibling entries.`,
);
