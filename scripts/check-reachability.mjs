import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { KNOWN_UNREACHABLE, MUST_BE_REACHABLE } from "./lib/reachable-surfaces.mjs";

// Tests prove a function works. They cannot prove the product contains it: a
// module is resolved by the bundler as soon as something imports it, and then
// dropped when nothing emitted calls it. This gate reads the build metafile and
// the built output, which are the only sources that answer "is this in the
// product?".
//
// It runs against the build, so it must come after `build` in the pipeline.
const root = fileURLToPath(new URL("../", import.meta.url));
const metafilePath = path.join(root, "dist", "metafile.json");
const metafile = JSON.parse(readFileSync(metafilePath, "utf8"));

// esbuild attributes output bytes per input, per output file. A module whose
// exports are unused ends up with no output entry carrying bytes for it.
const emitted = new Set();
for (const output of Object.values(metafile.outputs)) {
  for (const [input, details] of Object.entries(output.inputs ?? {})) {
    if ((details.bytesInOutput ?? 0) > 0) emitted.add(input);
  }
}

const violations = [];
for (const surface of MUST_BE_REACHABLE) {
  if (!emitted.has(surface.path)) {
    violations.push(
      `${surface.path} (${surface.owns}) contributes no bytes to the build; the product does not reach it. ` +
        `Wire it to something the entry reaches, or move it to KNOWN_UNREACHABLE with a reason.`,
    );
  }
}

// Markers are read from the built JavaScript so a declared unreachable surface
// is checked where it would actually appear. Directories under dist that hold
// no JavaScript (assets, fixtures) are skipped.
const builtJs = [];
const collect = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) builtJs.push(full);
  }
};
collect(path.join(root, "dist"));
const builtSource = builtJs.map((file) => readFileSync(file, "utf8")).join("\n");

for (const surface of KNOWN_UNREACHABLE) {
  if (builtSource.includes(surface.absentMarker)) {
    violations.push(
      `${surface.path} now reaches the product (found "${surface.absentMarker}"). ` +
        `Remove it from KNOWN_UNREACHABLE and add it to MUST_BE_REACHABLE: ${surface.reason}`,
    );
  }
}

if (violations.length) {
  throw new Error(`Reachability check failed:\n${violations.join("\n")}`);
}
console.log(
  `Reachability check passed: ${MUST_BE_REACHABLE.length} product surfaces are in the build, ` +
    `${KNOWN_UNREACHABLE.length} declared surfaces stay out.`,
);
