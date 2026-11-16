import { randomUUID } from 'node:crypto';
import type { TeamCommandRequest, TeamCommandResult, TeamModelRef, TeamPreset, TeamSnapshot, TeamTask } from './contracts.js';
import { isTeamCommand, isTeamPreset } from './schema.js';
import { TeamStore, type ActiveTeam, type TeamState } from './store.js';

export interface TeamSession {
  sessionId: string;
  parentSessionId?: string | null;
  sessionKind: string;
  status: string;
  archived: boolean;
  effectiveModel?: string | null;
  errorMessage?: string;
}
export interface TeamExecution {
  start(task: TeamTask, member: TeamPreset['members'][number]): Promise<{ sessionId: string; taskId: string; error?: string }>;
  continue(task: TeamTask, content: string): Promise<{ taskId: string }>;
}
export interface TeamPorts {
  getSession(id: string): Promise<TeamSession | undefined>;
  listAgents(): Promise<{ name: string; displayName: string }[]>;
  listModels(): Promise<readonly TeamModelRef[]>;
  enqueue(sessionId: string, content: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
}
const key = (model: TeamModelRef) => `${model.providerId}/${model.modelId}`;
const activeStatuses = new Set(['running', 'submitted', 'rejected']);

export class TeamService {
  readonly store: TeamStore;
  constructor(dataDir: string, private readonly ports: TeamPorts) { this.store = new TeamStore(dataDir); }

  async execute(request: TeamCommandRequest, execution?: TeamExecution): Promise<TeamCommandResult> {
    if (!isTeamCommand(request)) throw new Error('Invalid Agent Teams command');
    return this.store.serial(async () => {
      const state = await this.store.read();
      const caller = await this.requireSession(request.sessionId);
      const team = await this.findTeam(state, caller);
      if (request.action === 'list') {
        return { message: 'Agent Teams presets. Family policies are explicit catalog selections, not automatic provider families.', presets: state.presets, agents: await this.ports.listAgents(), ...(team ? { snapshot: await this.snapshot(team) } : {}) };
      }
      if (request.action === 'status') return team ? { message: 'Agent Teams status; idle is not approval.', snapshot: await this.snapshot(team) } : { message: 'No active team for this session.', presets: state.presets };
      if (['save-preset', 'delete-preset', 'activate'].includes(request.action)) {
        if (caller.parentSessionId || caller.sessionKind === 'task') throw new Error('Only a root session may configure Agent Teams');
      }
      if (request.action === 'save-preset') {
        await this.validatePreset(request.preset);
        const previous = state.presets.findIndex(p => p.name === request.preset.name);
        if (previous >= 0) state.presets[previous] = structuredClone(request.preset);
        else state.presets.push(structuredClone(request.preset));
        await this.store.save(state);
        return { message: `Saved team preset ${request.preset.name}.`, presets: state.presets };
      }
      if (request.action === 'delete-preset') {
        if (!state.presets.some(p => p.name === request.name)) throw new Error('Team preset not found');
        state.presets = state.presets.filter(p => p.name !== request.name);
        await this.store.save(state);
        return { message: `Deleted preset ${request.name}; active teams retain their composition.`, presets: state.presets };
      }
      if (request.action === 'activate') {
        if (team) throw new Error('A team is already active; deactivate it first');
        const preset = state.presets.find(p => p.name === request.name);
        if (!preset) throw new Error('Team preset not found');
        await this.validatePreset(preset);
        const next: ActiveTeam = { rootSessionId: caller.sessionId, preset: structuredClone(preset), tasks: [] };
        state.teams.push(next);
        await this.store.save(state);
        return { message: `Activated ${preset.name}.`, snapshot: await this.snapshot(next) };
      }
      if (!team) throw new Error('No active team for this session');
      await this.requireMember(team, caller);
      const leader = caller.sessionId === team.rootSessionId;
      if (request.action === 'message') {
        await this.requireMember(team, await this.requireSession(request.toSessionId));
        await this.ports.enqueue(request.toSessionId, `[Team message from session ${caller.sessionId}]\n${request.content}`);
        return { message: 'Message accepted by the recipient session queue.', snapshot: await this.snapshot(team) };
      }
      if (request.action === 'submit-task') {
        const task = this.requireTask(team, request.taskId);
        if (task.sessionId !== caller.sessionId && !leader) throw new Error('Only the assigned worker or leader may submit this task');
        if (leader && !task.sessionId) throw new Error('Leader may only record a delivery from an admitted worker');
        if (task.status !== 'running') throw new Error('Only a running task may be submitted');
        task.revision++;
        task.delivery = request.delivery;
        task.status = 'submitted';
        delete task.review;
        await this.store.save(state);
        await this.ports.enqueue(team.rootSessionId, `[Team delivery] Task ${task.id} submitted by ${caller.sessionId}. Inspect the shared board and worker session; call review-task explicitly. Idle/completion is not approval.`);
        return { message: 'Delivery submitted for leader review.', snapshot: await this.snapshot(team) };
      }
      if (!leader) throw new Error('Only the team leader may perform this operation');
      if (request.action === 'deactivate') {
        if (team.tasks.some(t => activeStatuses.has(t.status))) throw new Error('Cancel or review active tasks before deactivating');
        state.teams = state.teams.filter(t => t !== team);
        await this.store.save(state);
        return { message: 'Team deactivated.', presets: state.presets };
      }
      if (request.action === 'create-task') {
        if (!team.preset.members.some(m => m.name === request.member)) throw new Error('Unknown team member');
        const dependencies = request.dependencies ?? [];
        for (const id of dependencies) this.requireTask(team, id);
        team.tasks.push({ id: randomUUID(), revision: 1, title: request.title, instructions: request.instructions, member: request.member, dependencies, status: 'pending' });
        await this.store.save(state);
        return { message: 'Shared task created.', snapshot: await this.snapshot(team) };
      }
      const task = this.requireTask(team, request.taskId);
      if (request.action === 'review-task') {
        if (task.status !== 'submitted') throw new Error('Only an explicitly submitted delivery may be reviewed');
        if (task.revision !== request.expectedRevision) throw new Error('Delivery changed; inspect the current revision before reviewing');
        task.revision++;
        task.review = { decision: request.decision, feedback: request.feedback, sessionId: caller.sessionId };
        task.status = request.decision === 'approve' ? 'approved' : 'rejected';
        await this.store.save(state);
        return { message: `Delivery ${task.status}.`, snapshot: await this.snapshot(team) };
      }
      if (request.action === 'cancel-task') {
        if (task.status === 'approved' || task.status === 'cancelled') throw new Error('Task is already terminal');
        if (task.sessionId) await this.ports.cancel(task.sessionId);
        task.revision++;
        task.status = 'cancelled';
        await this.store.save(state);
        return { message: 'Task cancelled.', snapshot: await this.snapshot(team) };
      }
      this.requireDependencies(team, task);
      if (request.action === 'start-task' && !(task.status === 'pending' || (task.status === 'failed' && !task.sessionId && !task.runtimeTaskId))) throw new Error('Only a pending or safely retryable failed task may be started');
      if (request.action === 'continue-task' && (!task.sessionId || !task.runtimeTaskId || !['running', 'submitted', 'rejected', 'failed'].includes(task.status))) throw new Error('Task has no continuable worker');
      if (!execution) {
        await this.ports.enqueue(team.rootSessionId, `[Agent Teams control request] Execute team_coordination with ${JSON.stringify({ action: request.action, taskId: task.id, ...(request.action === 'continue-task' ? { content: request.content } : {}) })}. This is a request, not a worker-start confirmation.`);
        return { message: 'Instruction queued for the leader; worker execution has not been confirmed.', queued: true, snapshot: await this.snapshot(team) };
      }
      const member = team.preset.members.find(m => m.name === task.member);
      if (!member) throw new Error('Unknown member');
      // Persist intent first. A process crash leaves a visible unresolved launch, never a false success.
      task.revision++;
      task.status = 'running';
      task.error = 'Worker admission pending; if interrupted, inspect runtime tasks before retrying.';
      await this.store.save(state);
      let admittedNewWorker = false;
      try {
        if (request.action === 'start-task') {
          const started = await execution.start(structuredClone(task), member);
          // Retain authoritative handles before ANY post-admission read/validation can fail.
          task.sessionId = started.sessionId;
          task.runtimeTaskId = started.taskId;
          admittedNewWorker = true;
          await this.store.save(state);
          if (started.error) throw new Error(started.error);
          const child = await this.requireSession(started.sessionId);
          if (child.parentSessionId !== team.rootSessionId || child.sessionKind !== 'task') throw new Error('Task runtime returned an invalid worker session');
        } else {
          const continued = await execution.continue(structuredClone(task), request.content);
          task.runtimeTaskId = continued.taskId;
        }
        delete task.error;
        delete task.delivery;
        delete task.review;
        await this.store.save(state);
      } catch (error) {
        let detail = error instanceof Error ? error.message : String(error);
        if (admittedNewWorker && task.sessionId) {
          detail += `; admitted worker session=${task.sessionId}, task=${task.runtimeTaskId ?? 'missing'}`;
          try { await this.ports.cancel(task.sessionId); detail += '; rollback cancellation accepted'; }
          catch (cancelError) { detail += `; rollback cancellation FAILED: ${cancelError instanceof Error ? cancelError.message : String(cancelError)}`; }
        }
        task.revision++;
        task.status = 'failed';
        task.error = detail.slice(0, 2000) || 'Worker admission failed';
        try { await this.store.save(state); }
        catch (persistenceError) {
          throw new Error(`${detail}; FAILED to persist reconciliation: ${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`, { cause: error });
        }
        throw new Error(detail, { cause: error });
      }
      return { message: 'Worker admitted by the task runtime.', snapshot: await this.snapshot(team) };
    });
  }

  /** Called on the actual resolved creation/continuation model, including descendants. */
  async assertModel(session: TeamSession, model: TeamModelRef): Promise<void> {
    const team = await this.findTeam(await this.store.read(), session);
    if (!team || session.sessionId === team.rootSessionId) return;
    const policy = team.preset.policy;
    if (policy.mode !== 'inherit' && !policy.models.some(ref => key(ref) === key(model))) throw new Error(`Agent Teams policy blocks model ${key(model)}; no fallback is permitted`);
    const assigned = team.tasks.find(t => t.sessionId === session.sessionId);
    const member = assigned && team.preset.members.find(m => m.name === assigned.member);
    if (member?.model && key(member.model) !== key(model)) throw new Error(`Team member requires model ${key(member.model)}; no fallback is permitted`);
  }

  async assertResolvedModel(session: TeamSession, selected: TeamModelRef, actual: TeamModelRef, runtimeProvider: () => string): Promise<void> {
    const team = await this.findTeam(await this.store.read(), session);
    if (!team || session.sessionId === team.rootSessionId) return;
    const expectedProvider = runtimeProvider();
    if (actual.providerId !== expectedProvider || actual.modelId !== selected.modelId) {
      throw new Error(`Agent Teams blocks resolved fallback ${key(actual)} from ${key(selected)}; no fallback is permitted`);
    }
    // Validate canonical catalog IDs, not a Pi transport alias such as an OAuth provider key.
    await this.assertModel(session, selected);
  }

  async reminder(sessionId: string): Promise<string> {
    const session = await this.requireSession(sessionId);
    const team = await this.findTeam(await this.store.read(), session);
    if (!team) return '';
    const assigned = team.tasks.find(t => t.sessionId === sessionId);
    return `[Agent Teams: ${team.preset.name}; leader session ${team.rootSessionId}]\nUse team_coordination status to discover the shared board and live session statuses. Communicate via message (runtime session queues), not a separate mailbox. ${sessionId === team.rootSessionId ? 'Create tasks, start-task/continue-task through team_coordination (existing task/task_append runtime). Dependencies require explicit approved deliveries. Inspect evidence and explicitly approve or reject each submitted delivery; idle or task completion is NOT approval.' : `You are a worker${assigned ? ` assigned task ${assigned.id}` : ''}. When mutation tools are admitted, submit with submit-task and delivery evidence. If read-only/tool-disabled, return evidence normally so the leader can explicitly record it with submit-task. Only the leader reviews; never autoapprove. Do not delegate to bypass team model policy.`}`;
  }

  private async validatePreset(preset: TeamPreset): Promise<void> {
    if (!isTeamPreset(preset)) throw new Error('Invalid team preset');
    if (new Set(preset.members.map(m => m.name)).size !== preset.members.length) throw new Error('Duplicate team member names');
    const agents = await this.ports.listAgents();
    const models = await this.ports.listModels();
    const policy = preset.policy;
    for (const model of [...(policy.mode === 'inherit' ? [] : policy.models), ...preset.members.flatMap(m => m.model ? [m.model] : [])]) {
      if (!models.some(ref => key(ref) === key(model))) throw new Error(`Model ${key(model)} is not in the current selectable catalog`);
    }
    for (const member of preset.members) {
      if (!agents.some(a => a.name === member.agentName)) throw new Error(`Agent ${member.agentName} is not an existing delegatable agent`);
      if (member.model && policy.mode !== 'inherit' && !policy.models.some(m => key(m) === key(member.model!))) throw new Error('Member model is outside team policy');
    }
  }

  private async findTeam(state: TeamState, session: TeamSession): Promise<ActiveTeam | undefined> {
    const visited = new Set<string>();
    let current: TeamSession | undefined = session;
    while (current) {
      if (visited.has(current.sessionId) || visited.size >= 64) throw new Error('Invalid or excessively deep runtime session ancestry');
      visited.add(current.sessionId);
      const team = state.teams.find(t => t.rootSessionId === current?.sessionId);
      if (team) return team;
      if (!current.parentSessionId) return undefined;
      current = await this.requireSession(current.parentSessionId);
    }
    return undefined;
  }
  private async requireSession(id: string): Promise<TeamSession> {
    const session = await this.ports.getSession(id);
    if (!session || session.archived) throw new Error('Runtime session not found or archived');
    return session;
  }
  private async requireMember(team: ActiveTeam, session: TeamSession): Promise<void> {
    if (session.sessionId === team.rootSessionId) return;
    if (!team.tasks.some(t => t.sessionId === session.sessionId)) throw new Error('Caller/recipient is not a team member');
    if (await this.findTeam({ version: 1, presets: [], teams: [team] }, session) !== team) throw new Error('Session does not belong to this team');
  }
  private requireTask(team: ActiveTeam, id: string): TeamTask {
    const task = team.tasks.find(t => t.id === id);
    if (!task) throw new Error('Team task not found');
    return task;
  }
  private requireDependencies(team: ActiveTeam, task: TeamTask): void {
    if (task.dependencies.some(id => this.requireTask(team, id).status !== 'approved')) throw new Error('Task dependencies require leader-approved deliveries');
  }
  private async snapshot(team: ActiveTeam): Promise<TeamSnapshot> {
    const result = structuredClone(team);
    const sessions: TeamSnapshot['sessions'] = [];
    for (const id of new Set([team.rootSessionId, ...team.tasks.flatMap(t => t.sessionId ? [t.sessionId] : [])])) {
      const session = await this.ports.getSession(id);
      sessions.push({ sessionId: id, status: !session ? 'missing' : session.archived ? 'archived' : session.status });
      for (const task of result.tasks.filter(t => t.sessionId === id && t.status === 'running')) {
        if (!session || session.archived || ['error', 'aborted', 'interrupted'].includes(session.status)) {
          task.status = session?.status === 'aborted' ? 'cancelled' : 'failed';
          task.error = session?.errorMessage || `Runtime worker ${session?.status ?? 'missing'}`;
        }
      }
    }
    return { ...result, sessions };
  }
}
