import { describe, expect, it, vi } from 'vitest';

import { runMcodeProviderCommand } from '../../src/cli/provider-command.js';

describe('provider add CLI metadata', () => {
  it('forwards context window, max output, and effort levels into the model inputs', async () => {
    const create = vi.fn(async () => undefined);
    const result = await runMcodeProviderCommand({
      version: '0.0.0-test',
      environment: { OPENCODE_API_KEY: 'test-key' },
      request: {
        action: 'add',
        name: 'OpenCode Go',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        apiFormat: 'openai-completions',
        models: ['deepseek-v4.1-flash'],
        apiKeyEnv: 'OPENCODE_API_KEY',
        contextWindow: 1_000_000,
        maxOutput: 384_000,
        effortOptions: ['low', 'high', 'max'],
      },
      createContext: async () => ({
        application: { create } as never,
        shutdown: async () => undefined,
      }),
    });

    expect(result).toBe('Provider added: OpenCode Go');
    expect(create).toHaveBeenCalledWith({
      name: 'OpenCode Go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKey: 'test-key',
      apiFormat: 'openai-completions',
      models: [
        {
          modelId: 'deepseek-v4.1-flash',
          effortOptions: ['low', 'high', 'max'],
          limit: { context: 1_000_000, output: 384_000 },
        },
      ],
    });
  });

  it('tests the candidate before saving and selecting it with --use', async () => {
    const create = vi.fn(async () => undefined);
    const saveCandidate = vi.fn(async () => ({ success: true }));
    const result = await runMcodeProviderCommand({
      version: '0.0.0-test',
      environment: { OPENCODE_API_KEY: 'test-key' },
      request: {
        action: 'add',
        name: 'OpenCode Go',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        apiFormat: 'openai-completions',
        models: ['deepseek-v4.1-flash'],
        apiKeyEnv: 'OPENCODE_API_KEY',
        saveAndUse: true,
      },
      createContext: async () => ({
        application: { create, saveCandidate } as never,
        shutdown: async () => undefined,
      }),
    });

    expect(result).toBe('Provider added and selected: OpenCode Go');
    expect(create).not.toHaveBeenCalled();
    expect(saveCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'deepseek-v4.1-flash',
        saveAndUse: true,
        baseUrl: 'https://opencode.ai/zen/go/v1',
      }),
    );
  });

  it('fails without saving when the --use connection test fails', async () => {
    const create = vi.fn(async () => undefined);
    const saveCandidate = vi.fn(async () => ({
      success: false,
      status: { state: 'failed', lastErrorMessage: 'HTTP 401' },
    }));
    await expect(
      runMcodeProviderCommand({
        version: '0.0.0-test',
        environment: { OPENCODE_API_KEY: 'test-key' },
        request: {
          action: 'add',
          name: 'OpenCode Go',
          baseUrl: 'https://opencode.ai/zen/go/v1',
          apiFormat: 'openai-completions',
          models: ['deepseek-v4.1-flash'],
          apiKeyEnv: 'OPENCODE_API_KEY',
          saveAndUse: true,
        },
        createContext: async () => ({
          application: { create, saveCandidate } as never,
          shutdown: async () => undefined,
        }),
      }),
    ).rejects.toThrow(/connection test failed/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the plain model list when no metadata is provided', async () => {
    const create = vi.fn(async () => undefined);
    await runMcodeProviderCommand({
      version: '0.0.0-test',
      environment: { MCODE_PROVIDER_API_KEY: 'test-key' },
      request: {
        action: 'add',
        name: 'Plain Provider',
        baseUrl: 'https://example.test/v1',
        apiFormat: 'openai-completions',
        models: ['model-a'],
      },
      createContext: async () => ({
        application: { create } as never,
        shutdown: async () => undefined,
      }),
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ models: [{ modelId: 'model-a' }] }),
    );
  });
});
