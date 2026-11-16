# Local and Computer Research

Use the cheapest authoritative surface for each question. Search local files through filesystem tools;
use browser or desktop control for information that exists only in an interactive application.

## Search order

1. Start with the named workspace or target roots. Use `rg --files <root>` to understand layout, then
   targeted `rg` searches with relevant extensions and exclusions.
2. Locate manifests, entry points, IPC/RPC definitions, permission declarations, updater/service
   configuration, build metadata, and existing reports before searching implementation details.
3. Search filenames and narrow metadata before file contents. Avoid recursively searching a whole
   home directory or drive when a smaller root can answer the question.
4. Hash exact binaries, packages, firmware, archives, or generated inputs before analysis. Treat a
   path or filename as mutable identity until it has a hash.
5. Use authoritative local tools and repository scripts when available. Keep outputs in a fresh run
   directory; do not overwrite old reports or tool state.
6. Use web research for current program scope, advisories, release notes, public fixes, and duplicate
   evidence. Prefer primary sources and record access dates when current state matters.
7. Use GUI/browser automation for authenticated portals, visual-only state, or applications without a
   usable file/API surface. Capture the page, window, account context, and time needed to interpret
   screenshots. Never treat a screenshot alone as proof of backend behavior.

## Computer-use discipline

- Inventory visible windows before interacting. Confirm the target application and active account.
- Read existing state before clicking. Avoid actions that submit, publish, delete, update, or execute a
  target unless the user authorized that effect.
- Export or copy evidence into the campaign output root when the application permits it, preserving the
  original filename and recording its source.
- After a long-running action, inspect status/log/heartbeat data instead of assuming the UI is frozen.
- Do not use Task Manager or close processes as a diagnostic shortcut when doing so could change the
  behavior under investigation.

## Provenance record

For each material artifact record:

- source path or URL;
- SHA-256 when bytes are available;
- acquisition time and method;
- producer/tool version and relevant arguments;
- relationship to the frozen target;
- status: `original`, `derived`, `runtime-observation`, or `external-reference`.

Absence from one search is bounded negative evidence. State the searched roots, patterns, versions, and
tool limits before drawing a negative conclusion.
