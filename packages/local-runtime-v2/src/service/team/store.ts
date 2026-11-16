import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import lockfile from 'proper-lockfile';
import type { TeamPreset, TeamTask } from './contracts.js';
import { stateSchema } from './schema.js';

export interface ActiveTeam {
  rootSessionId: string;
  preset: TeamPreset;
  tasks: TeamTask[];
}
export interface TeamState {
  version: 1;
  presets: TeamPreset[];
  teams: ActiveTeam[];
}
const locks = new Map<string, Promise<void>>();
const MAX_BYTES = 16 * 1024 * 1024;
function validState(value: unknown): value is TeamState {
  if (!Value.Check(stateSchema, value)) return false;
  return true;
}

/** A single runtime-owned metadata document. Sessions/messages remain in SessionSystem. */
export class TeamStore {
  private readonly path: string;
  constructor(dataDir: string) { this.path = resolve(join(dataDir, 'v2', 'teams.json')); }

  async read(): Promise<TeamState> {
    try {
      if ((await stat(this.path)).size > MAX_BYTES) throw new Error('Agent Teams persistence exceeds size limit');
      const value: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!validState(value)) throw new Error('Invalid Agent Teams persistence schema');
      this.assertInvariants(value);
      return value;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { version: 1, presets: [], teams: [] };
      throw new Error(`Cannot read Agent Teams persistence: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async save(state: TeamState): Promise<void> {
    if (!validState(state)) throw new Error('Invalid Agent Teams state');
    this.assertInvariants(state);
    const body = JSON.stringify(state, null, 2) + '\n';
    if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Agent Teams persistence exceeds size limit');
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch(error => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      });
    }
  }

  async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = locks.get(this.path) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>(done => { release = done; });
    const tail = previous.then(() => gate);
    locks.set(this.path, tail);
    await previous;
    let unlock: (() => Promise<void>) | undefined;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      unlock = await lockfile.lock(this.path, { realpath: false, stale: 30_000, retries: { retries: 30, minTimeout: 50, maxTimeout: 500 } });
      return await operation();
    } finally {
      try { await unlock?.(); }
      finally { release(); if (locks.get(this.path) === tail) locks.delete(this.path); }
    }
  }

  private assertInvariants(state: TeamState): void {
    const unique = (values: string[]) => new Set(values).size === values.length;
    if (!unique(state.presets.map(p => p.name)) || !unique(state.teams.map(t => t.rootSessionId))) throw new Error('Duplicate Agent Teams identity');
    for (const preset of [...state.presets, ...state.teams.map(t => t.preset)]) {
      if (!unique(preset.members.map(m => m.name))) throw new Error('Duplicate team member');
    }
    for (const team of state.teams) {
      if (!unique(team.tasks.map(t => t.id))) throw new Error('Duplicate team task');
      const tasks = new Map(team.tasks.map(task => [task.id, task]));
      const colors = new Map<string, 'visiting' | 'done'>();
      const visit = (id: string): void => {
        if (colors.get(id) === 'visiting') throw new Error('Cyclic task dependency');
        if (colors.get(id) === 'done') return;
        colors.set(id, 'visiting');
        const task = tasks.get(id);
        if (!task) throw new Error('Invalid task dependency');
        for (const dependency of task.dependencies) visit(dependency);
        colors.set(id, 'done');
      };
      for (const task of team.tasks) {
        if (!team.preset.members.some(m => m.name === task.member)) throw new Error('Unknown team member');
        visit(task.id);
      }
    }
  }
}
