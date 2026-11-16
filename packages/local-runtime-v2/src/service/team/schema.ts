import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { TeamCommandRequest, TeamPreset } from './contracts.js';

const text = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: '\\S' });
const id = text(256);
const strict = { additionalProperties: false };
export const modelSchema = Type.Object({ providerId: id, modelId: id }, strict);
export const presetSchema = Type.Object({
  name: text(80),
  members: Type.Array(Type.Object({ name: text(80), agentName: id, model: Type.Optional(modelSchema) }, strict), { minItems: 1, maxItems: 16 }),
  policy: Type.Union([
    Type.Object({ mode: Type.Literal('inherit') }, strict),
    Type.Object({ mode: Type.Literal('allowlist'), models: Type.Array(modelSchema, { minItems: 1, maxItems: 128 }) }, strict),
    Type.Object({ mode: Type.Literal('family'), family: text(120), models: Type.Array(modelSchema, { minItems: 1, maxItems: 128 }) }, strict),
  ]),
}, strict);
const taskSchema = Type.Object({
  id, revision: Type.Integer({ minimum: 1 }), title: text(200), instructions: text(16000), member: text(80),
  dependencies: Type.Array(id, { maxItems: 64, uniqueItems: true }),
  status: Type.Union(['pending', 'running', 'submitted', 'approved', 'rejected', 'cancelled', 'failed'].map(value => Type.Literal(value))),
  sessionId: Type.Optional(id), runtimeTaskId: Type.Optional(id), delivery: Type.Optional(text(16000)),
  review: Type.Optional(Type.Object({ decision: Type.Union([Type.Literal('approve'), Type.Literal('reject')]), feedback: Type.String({ maxLength: 16000 }), sessionId: id }, strict)),
  error: Type.Optional(text(2000)),
}, strict);
export const stateSchema = Type.Object({
  version: Type.Literal(1),
  presets: Type.Array(presetSchema, { maxItems: 64 }),
  teams: Type.Array(Type.Object({ rootSessionId: id, preset: presetSchema, tasks: Type.Array(taskSchema, { maxItems: 256 }) }, strict), { maxItems: 128 }),
}, strict);

export const commandSchema = Type.Union([
  ...['list', 'deactivate', 'status'].map(action => Type.Object({ sessionId: id, action: Type.Literal(action) }, strict)),
  Type.Object({ sessionId: id, action: Type.Literal('save-preset'), preset: presetSchema }, strict),
  ...['delete-preset', 'activate'].map(action => Type.Object({ sessionId: id, action: Type.Literal(action), name: text(80) }, strict)),
  Type.Object({ sessionId: id, action: Type.Literal('create-task'), title: text(200), instructions: text(16000), member: text(80), dependencies: Type.Optional(Type.Array(id, { maxItems: 64, uniqueItems: true })) }, strict),
  ...['start-task', 'cancel-task'].map(action => Type.Object({ sessionId: id, action: Type.Literal(action), taskId: id }, strict)),
  Type.Object({ sessionId: id, action: Type.Literal('continue-task'), taskId: id, content: text(16000) }, strict),
  Type.Object({ sessionId: id, action: Type.Literal('submit-task'), taskId: id, delivery: text(16000) }, strict),
  Type.Object({ sessionId: id, action: Type.Literal('review-task'), taskId: id, expectedRevision: Type.Integer({ minimum: 1 }), decision: Type.Union([Type.Literal('approve'), Type.Literal('reject')]), feedback: Type.String({ maxLength: 16000 }) }, strict),
  Type.Object({ sessionId: id, action: Type.Literal('message'), toSessionId: id, content: text(16000) }, strict),
]);

export function isTeamCommand(value: unknown): value is TeamCommandRequest {
  return Value.Check(commandSchema, value);
}
export function isTeamPreset(value: unknown): value is TeamPreset {
  return Value.Check(presetSchema, value);
}
