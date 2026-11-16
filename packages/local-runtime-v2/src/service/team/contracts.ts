/** Public process-local Agent Teams API. Model references contain IDs, never credentials. */
export interface TeamModelRef {
  providerId: string;
  modelId: string;
}

export type TeamModelPolicy =
  | { mode: 'inherit' }
  | { mode: 'allowlist'; models: TeamModelRef[] }
  /** Explicit catalog selection, not a provider/prefix heuristic. New models are not auto-added. */
  | { mode: 'family'; family: string; models: TeamModelRef[] };

export interface TeamMemberPreset {
  /** Stable role key within this preset, e.g. investigator or reviewer. */
  name: string;
  agentName: string;
  model?: TeamModelRef;
}

export interface TeamPreset {
  name: string;
  members: TeamMemberPreset[];
  policy: TeamModelPolicy;
}

export type TeamTaskStatus = 'pending' | 'running' | 'submitted' | 'approved' | 'rejected' | 'cancelled' | 'failed';

export interface TeamTask {
  id: string;
  /** Optimistic review guard: changes whenever the task/delivery changes. */
  revision: number;
  title: string;
  instructions: string;
  member: string;
  dependencies: string[];
  status: TeamTaskStatus;
  /** References to authoritative runtime records; no mirrored conversation/mailbox. */
  sessionId?: string;
  runtimeTaskId?: string;
  delivery?: string;
  review?: { decision: 'approve' | 'reject'; feedback: string; sessionId: string };
  error?: string;
}

export interface TeamSnapshot {
  rootSessionId: string;
  preset: TeamPreset;
  tasks: TeamTask[];
  /** Live runtime status is informational only; idle NEVER means approved. */
  sessions: { sessionId: string; status: string }[];
}

/** sessionId is the selected CLI session. Native tools bind it to the runtime caller. */
export type TeamCommandRequest = { sessionId: string } & (
  | { action: 'list' }
  | { action: 'save-preset'; preset: TeamPreset }
  | { action: 'delete-preset'; name: string }
  | { action: 'activate'; name: string }
  | { action: 'deactivate' }
  | { action: 'status' }
  | { action: 'create-task'; title: string; instructions: string; member: string; dependencies?: string[] }
  /** Start/continue uses the existing task/task_append tools in an admitted leader turn. */
  | { action: 'start-task'; taskId: string }
  | { action: 'continue-task'; taskId: string; content: string }
  | { action: 'cancel-task'; taskId: string }
  | { action: 'submit-task'; taskId: string; delivery: string }
  | { action: 'review-task'; taskId: string; expectedRevision: number; decision: 'approve' | 'reject'; feedback: string }
  | { action: 'message'; toSessionId: string; content: string }
);

export interface TeamCommandResult {
  message: string;
  presets?: TeamPreset[];
  /** Existing delegatable agents, for preset composition (no Agent CRUD). */
  agents?: { name: string; displayName: string }[];
  snapshot?: TeamSnapshot;
  /** True means instruction queued for the leader, NOT that a worker has started. */
  queued?: boolean;
}
