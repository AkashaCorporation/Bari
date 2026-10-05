# Extension events

Every extension point the agent runtime exposes, who invokes it, and who
consumes it today. The list of names is declared once in
`packages/agent-runtime/src/types.ts` (`HOOK_NAMES`); `scripts/check-events.mjs`
fails when a declared name has no row here, or when a row names something that
is not declared.

## Why this exists

This map is not documentation for its own sake. A guard was once written
against `turnIntent: learning-maintenance` — a budget on the request and a tool
block on the step — and it was **dead code**, because nothing produced that
intent. Every consumer existed and every test passed. Nothing in the repository
made "an event with consumers and no producer" visible, so it survived review.

A row here forces the producer to be named. If a future hook has consumers but
no producer, the table says so at the point where someone has to write it down.

## How a hook reaches the runtime

1. An extension calls `api.on(<event>, handler)` during its `init` window. The
   registry stores handlers per event in an owner-scoped map
   (`agent-runtime/src/registry.ts`); registration outside that window is
   rejected.
2. At assembly, `HOOK_MAPPINGS` binds each event to the pi hook field that
   delivers it, and `turn_start` / `turn_end` are additionally collected into
   raw handler arrays.
3. The host runs the turn arrays itself
   (`local-agent-host.ts` → `runTurnStartHandlers`); pi invokes the mapped step
   and history hooks while a turn runs.

A hook that no mapping delivers and that the host does not run would never
fire. `check-events.mjs` verifies the mapping list covers every declared name
except the two the host runs directly.

## Hook map

| Event | Domain | Invoked by | Consumed today |
| --- | --- | --- | --- |
| `turn_start` | turn | host, from the assembled handler array | none in-tree; declared and wired |
| `turn_end` | turn | host, from the assembled handler array | `agent-extension/terminal-response-recovery.ts`, `agent-extension/source-reference.ts`, `agent-extension/runaway-guard.ts`, `local-runtime-v2/service/browser-use/policy.ts` |
| `on_history_changed` | turn | pi (`onHistoryChangedHook`) | `agent-extension/context-manager.ts` |
| `before_llm_call` | step | pi (`beforeLlmCallHook`) | `agent-extension/context-manager.ts`, `application/agent/goal-subagent-coordinator.ts`, `service/automation/coordinator.ts` |
| `on_llm_call_prepared` | step | pi (`onLlmCallPreparedHook`) | `agent-extension/session-report.ts` |
| `after_llm_call` | step | pi (`afterLlmCallHook`) | `agent-extension/terminal-response-recovery.ts`, `agent-extension/source-reference.ts`, `application/agent/goal-subagent-coordinator.ts` |
| `before_tool_call` | step | pi (`beforeToolCallHook`) | `agent-extension/permission.ts`, `agent-extension/runaway-guard.ts`, `application/agent/goal-subagent-coordinator.ts`, `service/automation/coordinator.ts` |
| `after_tool_call` | step | pi (`afterToolCallHook`) | `agent-extension/tool-output-budget.ts`, `agent-extension/source-reference.ts` |
| `on_step_end` | step | pi (`onStepEndHook`) | `agent-extension/terminal-response-recovery.ts`, `agent-extension/runaway-guard.ts` |

Paths are relative to `packages/`; `agent-extension/` is `packages/agent-extension/src/`.

Two hooks carry host-owned authority, so their consumers are worth knowing
before changing them:

- `before_llm_call` can return a rewritten request, which is how the Goal
  verifier and the learning coordinator clamp an inner request to a budget.
- `before_tool_call` can refuse a call, which is how permissions, the runaway
  guard and the learning coordinator's tool block take effect.

## Runtime event observers

A second seam observes the runtime event stream rather than the turn loop:
`observeRuntimeEvent`, combined with `combineAgentEventObservers` and registered
in `services.ts`. Observers see every published runtime event and cannot modify
it — they are for projection, reporting and admission, not for interception.

| Observer | Added by | Purpose |
| --- | --- | --- |
| `sessionLifecycleEvents` | session system | durable session lifecycle projection |
| `terminalReplies` | channel system | deliver terminal replies to channels |
| channel/plugin/metrics observers | their own subsystems | their own projections |
| `LearningLifecycleObserver` | `service/automation` | admit a learning run from a settled user turn, yield on user activity |

An observer that only ever runs for one ingress must check the turn's
provenance itself. `LearningLifecycleObserver` ignores turns whose source is
`learning`, `cron` or `background-task`, because treating host-owned work as
user work would let maintenance feed itself.

## Adding a hook

1. Add the name to `HOOK_NAMES` and give it a typed overload on `ExtensionAPI`.
2. Bind it in `HOOK_MAPPINGS`, or run it from the host and say so here.
3. Add a row to the hook map above naming the producer and the consumers.
4. `node scripts/check-events.mjs` must pass.
