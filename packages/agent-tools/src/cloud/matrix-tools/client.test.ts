import { describe, expect, it, vi } from 'vitest';

import { DesktopMatrixClient } from '../../desktop/matrix-client.js';
import {
  callMatrixTool,
  MatrixManagedLoginRequiredError,
} from './client.js';
import type { MatrixToolContext, MatrixToolLogger } from './types.js';

function testContext(): { ctx: MatrixToolContext; warnings: string[] } {
  const warnings: string[] = [];
  const matrixLogger: MatrixToolLogger = {
    info: () => undefined,
    warn: (_ctx, message) => warnings.push(message),
  };
  return {
    ctx: {
      sessionId: 'session-1',
      turnId: 'turn-1',
      workspaceRoot: process.cwd(),
      matrixLogger,
    } as unknown as MatrixToolContext,
    warnings,
  };
}

describe('matrix tool failure mapping', () => {
  it('reports the managed-login requirement instead of a generic request failure', async () => {
    const { ctx, warnings } = testContext();
    const archonServer = {
      postJson: vi.fn(async () => {
        throw new MatrixManagedLoginRequiredError();
      }),
    };
    const result = await callMatrixTool({
      toolName: 'web_search',
      path: '/matrix/api/v1/mcp/web_search',
      input: { query: 'bari' },
      ctx,
      archonServer,
    });

    expect(result.details).toMatchObject({ ok: false, error_code: 'MATRIX_TOOL_LOGIN_REQUIRED' });
    expect(result.text).toContain('MATRIX_TOOL_LOGIN_REQUIRED');
    expect(result.text).toContain('/login');
    expect(result.text).toContain('web_fetch');
    expect(warnings.some((line) => line.includes('code=MATRIX_TOOL_LOGIN_REQUIRED'))).toBe(true);
  });

  it('keeps the generic request failure for other executor errors', async () => {
    const { ctx } = testContext();
    const archonServer = {
      postJson: vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    };
    const result = await callMatrixTool({
      toolName: 'web_search',
      path: '/matrix/api/v1/mcp/web_search',
      input: { query: 'bari' },
      ctx,
      archonServer,
    });

    expect(result.details).toMatchObject({ ok: false, error_code: 'MATRIX_TOOL_REQUEST_FAILED' });
    expect(result.text).toBe('MATRIX_TOOL_REQUEST_FAILED: Matrix tool request failed.');
  });
});

describe('DesktopMatrixClient managed auth', () => {
  it('throws the typed login-required error for a managed endpoint without a token', () => {
    const client = new DesktopMatrixClient({ baseUrl: 'https://agent.minimax.cn' });
    expect(() => client.buildHeaders()).toThrow(MatrixManagedLoginRequiredError);
  });

  it('keeps sending the managed bearer token when one is available', () => {
    const client = new DesktopMatrixClient({
      baseUrl: 'https://agent.minimax.cn',
      authContext: { accessToken: 'token-1' },
    });
    expect(client.buildHeaders().Authorization).toBe('Bearer token-1');
  });
});
