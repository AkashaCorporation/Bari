/**
 * The capability seams this distribution declares, and the three roles each one
 * has to fill.
 *
 * A seam is a swappable capability: a Service Definition declaring the
 * interface, at least one Service Provider implementing it, and at least one
 * Consumer using it. A package may combine roles, but a role standing alone is
 * not a seam — a definition nobody implements is a plan, and a provider nobody
 * consumes is dead weight. `scripts/check-seams.mjs` fails on either.
 *
 * A consumer usually uses the capability through the provider it was wired
 * with (a factory call at composition) rather than by naming the definition
 * type, so a consumer satisfies the role when it imports the definition or any
 * declared provider. Both are real consumption; only one of them is visible in
 * the type system.
 *
 * `capability` states what changes for the whole product when the provider is
 * swapped. Writing it down is the point: a seam whose swap changes nothing
 * visible is either misnamed or unnecessary.
 */
export const CAPABILITY_SEAMS = [
  {
    key: 'message-repository',
    definition: 'packages/local-runtime-v2/src/service/session-system/messages/repo/contract.ts',
    capability:
      'How committed session messages are stored and read back. Swapping the provider moves every reader of session history, including the agent transcript, the display projection and fork.',
    providers: [
      'packages/local-runtime-v2/src/service/session-system/messages/repo/drizzle.ts',
    ],
    consumers: [
      'packages/local-runtime-v2/src/service/session-system/agent-projection.ts',
      'packages/local-runtime-v2/src/service/session-system/query-collapse-projector.ts',
    ],
  },
  {
    key: 'session-stream-writer',
    definition: 'packages/local-runtime-v2/src/service/session-system/stream/session-frame.ts',
    capability:
      'How a session publishes incremental frames to its readers. Swapping the provider changes every live surface that follows a session, including the query-collapse view and the agent projection.',
    providers: [
      'packages/local-runtime-v2/src/service/session-system/stream/session-stream-service.ts',
    ],
    consumers: [
      'packages/local-runtime-v2/src/service/session-system/query-collapse-projector.ts',
    ],
  },
  {
    key: 'canonical-history-file-adapter',
    definition:
      'packages/local-runtime-v2/src/service/session-system/sessions/representation/canonical-history-contract.ts',
    capability:
      'How the model-visible canonical history is read and replaced on disk. Swapping the provider changes what every history reader and mutation path sees, including replay identities and compaction snapshots.',
    providers: [
      'packages/local-runtime-v2/src/service/session-system/sessions/representation/canonical-history.ts',
    ],
    consumers: [
      'packages/local-runtime-v2/src/service/session-system/messages/history/canonical-history-provider.ts',
    ],
  },
  {
    key: 'sandbox-backend',
    definition: 'packages/local-runtime-v2/src/service/sandbox/backend/types.ts',
    capability:
      'How a spawned command is confined. Swapping the provider changes which platform can confine anything at all: the shipped backend is the macOS Seatbelt one, so other platforms run without a sandbox backend rather than with a weaker one.',
    providers: [
      'packages/local-runtime-v2/src/service/sandbox/backend/srt-macos.ts',
    ],
    consumers: [
      'packages/local-runtime-v2/src/service/sandbox/initialize.ts',
    ],
  },
  {
    key: 'session-source-query',
    definition:
      'packages/local-runtime-v2/src/service/session-system/messages/repo/source-query-contract.ts',
    capability:
      'How session history sources are projected and queried for the source views. Swapping the provider changes what the source query returns without changing the readers that request it.',
    providers: [
      'packages/local-runtime-v2/src/service/session-system/messages/repo/source-query.ts',
    ],
    consumers: [
      'packages/local-runtime-v2/src/service/session-system/owner.ts',
    ],
  },
];