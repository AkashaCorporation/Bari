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
      saveAndUse: undefined,
    });
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
