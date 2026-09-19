import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { routeLocalFileApi } from '../../src/files/api.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'bari-file-api-'));
  roots.push(root);
  return root;
}

function saveRequest(body: unknown): Request {
  return new Request('http://local/file/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function save(workspace: string, path: string, content: string): Promise<Response> {
  return routeLocalFileApi(saveRequest({ workspace, path, content }), ['file', 'save'], new URL(
    'http://local/file/save',
  ));
}

describe('POST /api/file/save', () => {
  it('creates a new file including missing parent directories', async () => {
    const root = createWorkspace();
    const response = await save(root, 'src/nested/new.txt', 'hello');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(readFileSync(join(root, 'src', 'nested', 'new.txt'), 'utf8')).toBe('hello');
  });

  it('overwrites an existing file', async () => {
    const root = createWorkspace();
    await save(root, 'keep.txt', 'one');
    const response = await save(root, 'keep.txt', 'two');

    expect(response.status).toBe(200);
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('two');
  });

  it('rejects paths that escape the workspace', async () => {
    const root = createWorkspace();
    const response = await save(root, '../escape.txt', 'x');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'PATH_TRAVERSAL' });
  });
});
