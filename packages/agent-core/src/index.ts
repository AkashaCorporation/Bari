/**
 * `@bari/agent-core`
 * -------------------
 *
 * Pure TypeScript core for Mavis agent-loop contracts.
 *
 * **Zero IO.** This package contains no filesystem access, no process
 * spawning, no SQLite, no HTTP server. IO modules belong in the host
 * packages (local-runtime, cloud-runtime).
 *
 * Subpath modules (`./event-bridge`, `./pi-turn-runner`, …) carry the
 * agent-loop assembly and conversion layers — import them directly so
 * consumers that only need protocol types pay no `@earendil-works/*`
 * loading cost.
 *
 * @see packages/agent-core/ARCHITECTURE.md
 */

export * from './protocol/index.js';
export * from './prompt-read.js';
export { collectFetchedWebSources } from '@bari/shared/fetched-web-sources';
export { shellSourceStages } from '@bari/shared/shell-source-stages';
export { collapseAdjacentDuplicateFileCitations } from '@bari/shared/file-source-citation';
export {
  collectWebSourceCitations,
  collectUsedWebEvidenceIds,
  type ContextualWebCitation,
} from '@bari/shared';
export {
  buildToolCallCitationId,
  compactToolCallCitationKey,
  findUniqueSingleSubstitutionCitationAlias,
  resolveKnownCitationAlias,
} from '@bari/shared/source-citation-id';
