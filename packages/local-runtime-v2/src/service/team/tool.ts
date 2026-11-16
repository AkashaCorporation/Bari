import { Type } from '@sinclair/typebox';
import type { RuntimeTool, ToolExecutionContext, ToolResult } from '@bari/agent-core/tools';
import type { TeamService, TeamExecution } from './service.js';
import { commandSchema, isTeamCommand } from './schema.js';

const binders = new WeakMap<RuntimeTool, (tools: readonly RuntimeTool[], readOnly: boolean) => RuntimeTool>();

/** Called only after the production catalog has applied selectors and canonical ceilings. */
export function bindTeamToolCatalog(tool: RuntimeTool, admitted: readonly RuntimeTool[], readOnly: boolean): RuntimeTool {
  return binders.get(tool)?.(admitted, readOnly) ?? tool;
}

export function createTeamTool(service: TeamService, sessionId: string): RuntimeTool {
  const build = (tools: readonly RuntimeTool[] | undefined, readOnly: boolean): RuntimeTool => ({
    def: {
      name: 'team_coordination',
      executionMode: 'sequential',
      description: 'Discover active Agent Teams with status/list. Shared board uses explicit dependencies and worker submissions; only runtime leader may approve/reject. start-task/continue-task delegate via existing task runtime. message uses session queues. Examples: {command:{action:"status"}}, {command:{action:"create-task",title:"Audit",instructions:"Inspect evidence",member:"investigator"}}, {command:{action:"submit-task",taskId:"ID",delivery:"Evidence"}}, {command:{action:"review-task",taskId:"ID",expectedRevision:3,decision:"approve",feedback:"Verified"}}. Runtime binds caller identity; do not provide sessionId. Family policy is a frozen explicit catalog selection, never provider inference.',
      schema: Type.Object({ command: Type.Union(commandSchema.anyOf.map(schema => Type.Omit(schema, ['sessionId']))) }, { additionalProperties: false }),
    },
    impl: { execute: async (ctx, input, signal) => {
      try {
        if (!tools) throw new Error('Team tool was not bound to the admitted turn catalog');
        if (ctx.sessionId !== sessionId) throw new Error('Team tool caller differs from the runtime session');
        if (!input || typeof input !== 'object' || !('command' in input)) throw new Error('command must be provided');
        const raw = input.command;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('command must be an object');
        if ('sessionId' in raw) throw new Error('Caller sessionId is runtime-owned and must not be supplied');
        const command = { ...raw, sessionId };
        if (!isTeamCommand(command)) throw new Error('Invalid team command; use action and the documented fields');
        if (readOnly && !['list', 'status'].includes(command.action)) throw new Error('Read-only canonical agents may only inspect Agent Teams');
        if (signal?.aborted) throw new Error('Team command cancelled before admission');
        const find = (name: string): RuntimeTool => {
          const tool = tools.find(t => t.def.name === name);
          if (!tool) throw new Error(`${name} is not admitted for this turn; team coordination cannot bypass tool policy`);
          return tool;
        };
        const run = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
          const result = await executeTool(find(name), ctx, args, signal);
          if (result.isError) throw new Error(result.text || `${name} failed`);
          return result;
        };
        const execution: TeamExecution = {
          start: async (task, member) => {
            const result = await executeTool(find('task'), ctx, {
              agent_name: member.agentName,
              description: task.title,
              prompt: `${task.instructions}\n\nAgent Teams shared task ID: ${task.id}. Call team_coordination status to discover your team. If team_coordination permits mutations, submit your delivery using submit-task with taskId=${task.id}; never approve it yourself. Read-only Explore/Verifier or tools-disabled workers must return delivery evidence normally; the leader records it explicitly via submit-task before review.`,
              run_in_background: true,
              ...(member.model ? { model: `${member.model.providerId}/${member.model.modelId}` } : {}),
            }, signal);
            const taskId = result.details?.task_id;
            const child = result.details?.sub_session_id;
            if (typeof taskId !== 'string' || typeof child !== 'string') throw new Error(result.isError ? result.text || 'Task admission failed' : 'Task runtime did not return worker session/task references');
            return { taskId, sessionId: child, ...(result.isError ? { error: result.text || 'Task admission interrupted' } : {}) };
          },
          continue: async (task, content) => {
            const result = await run('task_append', { task_id: task.runtimeTaskId, content });
            const taskId = result.details?.task_id;
            if (typeof taskId !== 'string') throw new Error('Task append did not return its runtime handle');
            return { taskId };
          },
        };
        // Underlying task_stop must also be admitted; cancellation is not a hidden capability.
        if (command.action === 'cancel-task') find('task_stop');
        const result = await service.execute(command, execution);
        const text = JSON.stringify(result);
        return { tool_name: 'team_coordination', text, content: [{ type: 'text', text }] };
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        return { tool_name: 'team_coordination', text, content: [{ type: 'text', text }], isError: true };
      }
    } },
  });
  const tool = build(undefined, true);
  binders.set(tool, (admitted, readOnly) => build(admitted, readOnly));
  return tool;
}

async function executeTool(tool: RuntimeTool, ctx: ToolExecutionContext, input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
  return tool.impl.execute(ctx, tool.def.prepareArguments?.(input) ?? input, signal);
}

/** Export the complete discriminated payload schema for local tooling/tests. */
export const teamCommandSchema = commandSchema;
