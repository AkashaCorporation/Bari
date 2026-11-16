import type {
  TeamCommandRequest, TeamCommandResult, TeamModelPolicy,
  TeamModelRef, TeamPreset, TeamSnapshot, TeamTask,
} from '@bari/local-runtime-v2/cli-service';
import type { TuiModel } from '../../types/runtime-models.js';
import { matchesKey, VStack, type Component } from '../engine/public.js';
import type { TuiFeatureScreen } from '../shell/surface-host.js';
import { Input } from '../widgets/input.js';
import { TuiSelectionScrollView } from '../widgets/selection-scroll-view.js';
import {
  panelContentWidth, renderPanelHeader, renderPanelRow, renderPanelDivider,
  renderPanelFooter, renderPanelBottom,
} from '../widgets/panel-frame.js';
import { sanitizeTerminalText } from '../rendering/terminal-text.js';
import { truncateToWidth, wrapTextWithAnsi } from '../rendering/text.js';

export type TuiTeamAction = TeamCommandRequest extends infer R
  ? R extends TeamCommandRequest ? Omit<R, 'sessionId'> : never : never;

type Choice = { label: string; select: () => void | Promise<void> };

export interface TuiTeamPresetPanelOptions {
  readonly initial: TeamCommandResult;
  readonly models: readonly TuiModel[];
  readonly execute: (action: TuiTeamAction) => Promise<TeamCommandResult>;
  readonly onTasks: () => void | Promise<void>;
  readonly onCancel: () => void;
  readonly requestRender: () => void;
}

/** Functional keyboard workflow on the existing feature surface (including regular mode). */
export class TuiTeamPresetPanel implements TuiFeatureScreen {
  readonly id = 'team-presets';
  readonly layoutRoot: Component;
  private readonly viewport: TuiSelectionScrollView;
  private readonly input = new Input();
  private presets: TeamPreset[];
  private agents: NonNullable<TeamCommandResult['agents']>;
  private snapshot?: TeamSnapshot;
  private choices: Choice[] = [];
  private details: string[] = [];
  private title = 'Teams';
  private notice = '';
  private selected = 0;
  private prompt?: { label: string; submit: (value: string) => void | Promise<void> };
  private back: () => void = () => this.options.onCancel();
  private busy = false;
  private disposed = false;
  private focusedValue = false;

  constructor(private readonly options: TuiTeamPresetPanelOptions) {
    this.presets = options.initial.presets ?? [];
    this.agents = options.initial.agents ?? [];
    this.snapshot = options.initial.snapshot;
    const header: Component = { render: (width) => [renderPanelHeader(safe(this.title), undefined, width)], invalidate() {} };
    const body: Component = { render: (width) => this.renderBody(width), invalidate() {} };
    const footer: Component = { render: (width) => this.renderFooter(width), invalidate() {} };
    this.viewport = new TuiSelectionScrollView(body, { primary: true, overscroll: 'contain' });
    this.layoutRoot = new VStack([
      { component: header, basis: 'auto', shrink: 1, minSize: 1 },
      { component: this.viewport, basis: 0, grow: 1, shrink: 1, minSize: 1 },
      { component: footer, basis: 'auto', shrink: 1, minSize: 1 },
    ]);
    this.input.onSubmit = (value) => {
      const trimmed = value.trim();
      if (!trimmed) { this.notice = 'A value is required.'; this.changed(); return; }
      const submit = this.prompt?.submit;
      if (submit) void this.guard(() => submit(trimmed));
    };
    this.home();
  }

  get focused(): boolean { return this.focusedValue; }
  set focused(value: boolean) {
    this.focusedValue = value;
    this.input.focused = value && Boolean(this.prompt);
  }
  invalidate(): void { this.input.invalidate(); this.layoutRoot.invalidate(); }
  dispose(): void { this.disposed = true; this.input.focused = false; }
  render(width: number): string[] {
    return [renderPanelHeader(safe(this.title), undefined, width), ...this.renderBody(width), ...this.renderFooter(width)];
  }

  handleInput(data: string): void {
    if (this.disposed) return;
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      // Do not abandon an in-flight mutation and accidentally repeat it in another screen.
      if (!this.busy) this.back();
      return;
    }
    if (this.busy) return;
    if (this.prompt) { this.input.handleInput(data); this.changed(); return; }
    if (matchesKey(data, 'up') || matchesKey(data, 'down')) {
      const delta = matchesKey(data, 'up') ? -1 : 1;
      this.selected = (this.selected + delta + this.choices.length) % Math.max(1, this.choices.length);
      this.changed();
    } else if (matchesKey(data, 'enter')) {
      const choice = this.choices[this.selected];
      if (choice) void this.guard(choice.select);
    }
  }

  private changed(): void { if (!this.disposed) this.options.requestRender(); }
  private menu(title: string, details: string[], choices: Choice[], back = () => this.home()): void {
    this.title = title;
    this.details = details;
    this.choices = choices;
    this.selected = 0;
    this.prompt = undefined;
    this.input.focused = false;
    this.back = back;
    this.changed();
  }
  private ask(label: string, submit: (value: string) => void | Promise<void>, back = () => this.home(), initial = ''): void {
    this.title = label;
    this.details = [];
    this.choices = [];
    this.prompt = { label, submit };
    this.input.setValue(initial);
    this.input.focused = this.focused;
    this.back = back;
    this.changed();
  }
  private async guard(work: () => void | Promise<void>): Promise<void> {
    this.busy = true;
    this.notice = '';
    this.changed();
    try { await work(); }
    catch (error) { this.notice = `Error: ${error instanceof Error ? error.message : String(error)}`; }
    finally { this.busy = false; this.changed(); }
  }
  private async execute(action: TuiTeamAction): Promise<void> {
    let result: TeamCommandResult;
    try { result = await this.options.execute(action); }
    catch (error) {
      if (action.action === 'review-task') {
        // Keep the submitted expectedRevision; never silently approve a newer delivery.
        try {
          const refreshed = await this.options.execute({ action: 'status' });
          this.snapshot = refreshed.snapshot;
          this.taskList();
        } catch (refreshError) {
          throw new Error(`${error instanceof Error ? error.message : String(error)}; status refresh failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
        }
      }
      throw error;
    }
    if (this.disposed) return;
    if (result.presets) this.presets = result.presets;
    if (result.agents) this.agents = result.agents;
    if (result.snapshot) this.snapshot = result.snapshot;
    if (action.action === 'deactivate') this.snapshot = undefined;
    if (action.action === 'status' && !result.snapshot) this.snapshot = undefined;
    this.notice = result.queued
      ? `${result.message} Queued for the leader; worker start is not confirmed. Refresh status.`
      : result.message;
  }
  private async refresh(): Promise<void> {
    await this.execute({ action: 'list' });
    await this.execute({ action: 'status' });
    this.home();
  }
  private home(): void {
    const active = this.snapshot;
    this.menu('Teams', [
      active ? `Active: ${active.preset.name} · root ${active.rootSessionId}` : 'No active team in this session.',
      'Runtime idle means no turn is running; it does not approve a task.',
      ...(active ? this.presetDetails(active.preset) : []),
      ...(active?.sessions.map((session) => `[RUNTIME ${session.status.toUpperCase()}] ${session.sessionId} · not a review decision`) ?? []),
    ], [
      { label: 'Refresh teams and status', select: () => this.refresh() },
      { label: 'Create or update preset', select: () => this.composePreset() },
      ...this.presets.map((preset): Choice => ({ label: `Preset · ${preset.name}`, select: () => this.presetMenu(preset) })),
      ...(active ? [
        { label: 'Review team tasks', select: () => this.taskList() },
        { label: 'Create task', select: () => this.createTask() },
        { label: 'Message a team session', select: () => this.messageSession() },
        { label: 'Deactivate team', select: async () => { await this.execute({ action: 'deactivate' }); this.home(); } },
      ] : []),
      { label: 'Open /tasks for live agents and transcripts', select: () => this.options.onTasks() },
    ], () => this.options.onCancel());
  }
  private presetDetails(preset: TeamPreset): string[] {
    const policy = preset.policy;
    return [
      policy.mode === 'inherit' ? 'Models: agent defaults / parent fallback (no restriction)'
        : `${policy.mode === 'family' ? `Declared family: ${policy.family}; exact allowlist` : 'Exact model allowlist'}: ${policy.models.map(modelLabel).join(', ')}`,
      ...preset.members.map((member) => `${member.name}: ${member.agentName} · ${member.model ? modelLabel(member.model) : 'agent defaults / parent fallback'}`),
    ];
  }
  private presetMenu(preset: TeamPreset): void {
    this.menu(`Preset: ${preset.name}`, this.presetDetails(preset), [
      { label: 'Activate in this session', select: async () => { await this.execute({ action: 'activate', name: preset.name }); this.home(); } },
      { label: 'Delete saved preset…', select: () => this.menu('Delete preset?', [preset.name], [
        { label: 'Cancel', select: () => this.presetMenu(preset) },
        { label: 'Confirm delete', select: async () => { await this.execute({ action: 'delete-preset', name: preset.name }); await this.execute({ action: 'list' }); this.home(); } },
      ]) },
    ]);
  }

  private composePreset(): void {
    if (!this.agents.length) { this.notice = 'No delegatable agents are available. Refresh the agent catalog.'; return; }
    this.ask('Preset name (e.g. HexCore)', (name) => {
      this.menu('Model policy', ['Only explicitly selected catalog models are included. No provider/family inference.'], [
        { label: 'Use agent defaults / parent fallback (no restriction)', select: () => this.chooseMembers(name, { mode: 'inherit' }) },
        { label: 'Exact model allowlist (select two or more if desired)', select: () => this.choosePolicyModels(name, 'allowlist') },
        { label: 'Declared family + exact selected models', select: () => this.ask('Declared family label', (family) => this.choosePolicyModels(name, 'family', family)) },
      ]);
    });
  }
  private choosePolicyModels(name: string, mode: 'allowlist' | 'family', family = ''): void {
    const models = uniqueModels(this.options.models);
    if (!models.length) { this.notice = 'No models are available. Configure a provider first.'; return; }
    const selected = new Set<number>();
    const show = () => this.menu('Select exact models', ['Enter toggles a model. Select Continue when finished.', 'Family is a declared label, NOT a guarantee about manufacturer or future models.'], [
      ...models.map((model, index): Choice => ({
        label: `${selected.has(index) ? '[x]' : '[ ]'} ${modelLabel(model)}`,
        select: () => { if (selected.has(index)) selected.delete(index); else selected.add(index); show(); this.selected = index; },
      })),
      { label: 'Continue with selected models', select: () => {
        if (!selected.size) throw new Error('Select at least one model.');
        const refs = models.filter((_, index) => selected.has(index)).map(modelRef);
        this.chooseMembers(name, mode === 'family' ? { mode, family, models: refs } : { mode, models: refs });
      } },
    ]);
    show();
  }
  private chooseMembers(name: string, policy: TeamModelPolicy): void {
    const selected = new Set<number>();
    const show = () => this.menu('Select existing agents', ['Enter toggles an agent. No new agents are created here.'], [
      ...this.agents.map((agent, index): Choice => ({
        label: `${selected.has(index) ? '[x]' : '[ ]'} ${agent.displayName} (${agent.name})`,
        select: () => { if (selected.has(index)) selected.delete(index); else selected.add(index); show(); this.selected = index; },
      })),
      { label: 'Continue / assign member models', select: () => {
        if (!selected.size) throw new Error('Select at least one existing agent.');
        const members = this.agents.filter((_, index) => selected.has(index)).map((agent) => ({ name: agent.name, agentName: agent.name }));
        this.assignModels({ name, policy, members }, 0);
      } },
    ]);
    show();
  }
  private assignModels(preset: TeamPreset, index: number): void {
    const member = preset.members[index];
    if (!member) {
      this.menu('Save preset', this.presetDetails(preset), [
        { label: `Save ${preset.name}`, select: async () => { await this.execute({ action: 'save-preset', preset }); await this.execute({ action: 'list' }); this.home(); } },
      ]);
      return;
    }
    const models = preset.policy.mode === 'inherit' ? uniqueModels(this.options.models) : preset.policy.models;
    const choose = (model?: TeamModelRef) => {
      const replacement: TeamPreset['members'][number] = { name: member.name, agentName: member.agentName, ...(model ? { model: modelRef(model) } : {}) };
      preset.members[index] = replacement;
      this.assignModels(preset, index + 1);
    };
    this.menu(`Model for ${member.name}`, ['Select a catalog model for this member.'], [
      ...(preset.policy.mode === 'inherit' ? [{ label: 'Use agent defaults / parent fallback (no restriction)', select: () => choose() }] : []),
      ...models.map((model): Choice => ({ label: modelLabel(model), select: () => choose(model) })),
    ]);
  }

  private taskList(): void {
    this.menu('Team tasks', ['Review state is explicit: submitted is not approved; runtime idle is not approved.'], [
      ...(this.snapshot?.tasks ?? []).map((task): Choice => ({ label: `${taskStatusBadge(task.status)} ${task.title} · ${task.member}`, select: () => this.taskMenu(task) })),
      { label: 'Create task', select: () => this.createTask() },
      { label: 'Refresh status', select: async () => { await this.execute({ action: 'status' }); this.taskList(); } },
    ]);
  }
  private taskMenu(task: TeamTask): void {
    const runtime = this.snapshot?.sessions.find((session) => session.sessionId === task.sessionId);
    this.menu(`Task: ${task.title}`, [
      `${taskStatusBadge(task.status)} ID ${task.id} · revision ${task.revision} · member ${task.member}`,
      `[RUNTIME ${(runtime?.status ?? 'unknown').toUpperCase()}] Session ${task.sessionId ?? 'not attached'} · not a review decision`,
      `Runtime task: ${task.runtimeTaskId ?? 'not attached'}`,
      `Dependencies: ${task.dependencies.join(', ') || 'none'}`,
      `Instructions: ${task.instructions}`,
      `Delivery: ${task.delivery ?? 'not submitted'}`,
      `Review: ${task.review ? `${task.review.decision} by ${task.review.sessionId}: ${task.review.feedback}` : 'not reviewed'}`,
      ...(task.error ? [`Error: ${task.error}`] : []),
    ], [
      { label: 'Request start (leader instruction)', select: async () => { await this.execute({ action: 'start-task', taskId: task.id }); this.taskList(); } },
      { label: 'Continue worker…', select: () => this.ask('Continuation instructions', async (content) => { await this.execute({ action: 'continue-task', taskId: task.id, content }); this.taskList(); }, () => this.taskMenu(task)) },
      { label: 'Submit delivery… (Runtime checks caller authority)', select: () => this.ask('Delivery / evidence', async (delivery) => { await this.execute({ action: 'submit-task', taskId: task.id, delivery }); this.taskList(); }, () => this.taskMenu(task)) },
      { label: 'Review: approve…', select: () => this.reviewTask(task, 'approve') },
      { label: 'Review: reject…', select: () => this.reviewTask(task, 'reject') },
      { label: 'Cancel task…', select: () => this.menu('Cancel task?', [task.title], [
        { label: 'Keep task', select: () => this.taskMenu(task) },
        { label: 'Confirm cancel', select: async () => { await this.execute({ action: 'cancel-task', taskId: task.id }); this.taskList(); } },
      ], () => this.taskMenu(task)) },
      ...(task.sessionId ? [{ label: 'Message session…', select: () => this.composeMessage(task.sessionId!) }] : []),
      { label: 'Refresh task status', select: async () => { await this.execute({ action: 'status' }); this.taskList(); } },
    ], () => this.taskList());
  }
  private reviewTask(task: TeamTask, decision: 'approve' | 'reject'): void {
    this.ask(`Review ${decision}: feedback / evidence`, async (feedback) => {
      await this.execute({ action: 'review-task', taskId: task.id, expectedRevision: task.revision, decision, feedback }); this.taskList();
    }, () => this.taskMenu(task));
  }
  private createTask(): void {
    const members = this.snapshot?.preset.members ?? [];
    this.menu('Assign task to member', [], members.map((member): Choice => ({ label: member.name, select: () => {
      this.ask('Task title', (title) => this.ask('Task instructions', (instructions) => {
        const dependencies = new Set<string>();
        const show = () => this.menu('Task dependencies', ['Select prerequisite tasks, then Create task. Only approved dependencies permit starting.'], [
          ...(this.snapshot?.tasks ?? []).map((task): Choice => ({ label: `${dependencies.has(task.id) ? '[x]' : '[ ]'} ${task.title} (${task.status})`, select: () => { if (dependencies.has(task.id)) dependencies.delete(task.id); else dependencies.add(task.id); show(); } })),
          { label: 'Create task', select: async () => { await this.execute({ action: 'create-task', member: member.name, title, instructions, dependencies: [...dependencies] }); this.taskList(); } },
        ]);
        show();
      }));
    } })));
  }
  private messageSession(): void {
    this.menu('Message team session', [], (this.snapshot?.sessions ?? []).map((session): Choice => ({
      label: `${session.sessionId} · ${session.status}`, select: () => this.composeMessage(session.sessionId),
    })));
  }
  private composeMessage(toSessionId: string): void {
    this.ask(`Message ${toSessionId}`, async (content) => { await this.execute({ action: 'message', toSessionId, content }); this.home(); });
  }
  private renderBody(width: number): string[] {
    const inner = panelContentWidth(width);
    if (inner <= 0) return [];
    const details = this.details.flatMap((line) => wrapTextWithAnsi(safe(line), inner));
    this.viewport.setActiveRow(this.prompt ? details.length : details.length + this.selected);
    const lines = [...details, ...this.choices.map((choice, index) => `${index === this.selected ? '>' : ' '} ${safe(choice.label)}`)];
    if (this.prompt) lines.push(...this.input.render(inner));
    while (lines.length < this.viewport.viewportHeight) lines.push('');
    return lines.map((line) => renderPanelRow(truncateToWidth(line, inner, ''), width));
  }
  private renderFooter(width: number): string[] {
    return [renderPanelDivider(width), ...renderPanelFooter(
      `${this.busy ? '[~] Working · ' : ''}${safe(this.notice)}${this.notice ? '\n' : ''}${this.prompt ? 'Enter submit · Esc cancel' : 'Up/Down select · Enter open/toggle · PgUp/PgDn scroll · Esc back'}`,
      panelContentWidth(width),
    ).map((line) => renderPanelRow(line, width)), renderPanelBottom(width)];
  }
}

function safe(value: string): string { return sanitizeTerminalText(value).replace(/[\r\n]/g, ' '); }

function taskStatusBadge(status: TeamTask['status']): string {
  switch (status) {
    case 'pending': return '[QUEUED]';
    case 'running': return '[RUNNING]';
    case 'submitted': return '[SUBMITTED]';
    case 'approved': return '[APPROVED]';
    case 'rejected': return '[REJECTED]';
    case 'cancelled': return '[CANCELLED]';
    case 'failed': return '[ERROR]';
  }
}

function modelRef(model: TeamModelRef): TeamModelRef { return { providerId: model.providerId, modelId: model.modelId }; }
function modelLabel(model: TeamModelRef): string { return `${model.providerId}/${model.modelId}`; }
function uniqueModels(models: readonly TuiModel[]): TuiModel[] {
  return models.filter((model, index) => models.findIndex((other) => other.providerId === model.providerId && other.modelId === model.modelId) === index);
}
