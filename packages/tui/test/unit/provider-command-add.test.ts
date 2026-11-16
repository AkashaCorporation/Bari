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

  it('refreshes one saved provider through the same application flow as /provider', async () => {
    const provider = {
      providerId: 'custom_provider:explabs',
      name: 'Experiential Labs',
      kind: 'custom',
      active: false,
      enabled: true,
      readOnly: false,
      configRevision: 'sha256:revision',
      baseUrl: 'https://api.experientiallabs.ai/v1',
      hasApiKey: true,
      models: [{ modelId: 'existing' }],
    } as const;
    const syncModels = vi.fn(async () => ({ added: 3, removed: 1, modelCount: 3 }));
    const output = await runMcodeProviderCommand({
      version: '0.0.0-test',
      request: {
        action: 'refresh',
        providerId: provider.providerId,
        json: true,
      },
      createContext: async () => ({
        application: {
          snapshot: vi.fn(async () => ({ minimaxModelSource: 'token_plan', providers: [provider] })),
          syncModels,
        } as never,
        shutdown: async () => undefined,
      }),
    });

    expect(JSON.parse(output)).toEqual({
      providerId: 'custom_provider:explabs',
      added: 3,
      removed: 1,
      previousModelCount: 1,
      modelCount: 3,
    });
    expect(syncModels).toHaveBeenCalledWith(provider);
  });

  it('refreshes the ChatGPT subscription catalog without running an API-key probe', async () => {
    const previous = {
      providerId: 'custom_provider:openai-codex',
      name: 'ChatGPT subscription',
      kind: 'custom',
      active: false,
      enabled: true,
      readOnly: true,
      hasApiKey: false,
      models: [{ modelId: 'gpt-6-sol' }, { modelId: 'retired-model' }],
    } as const;
    const current = {
      ...previous,
      models: [{ modelId: 'gpt-6-sol' }, { modelId: 'gpt-6.1-sol' }],
    } as const;
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce({ minimaxModelSource: 'token_plan', providers: [previous] })
      .mockResolvedValueOnce({ minimaxModelSource: 'token_plan', providers: [current] });
    const refreshCodexOAuthModels = vi.fn(async () => ({
      state: 'connected' as const,
      providerId: 'openai-codex' as const,
    }));
    const syncModels = vi.fn();

    const output = await runMcodeProviderCommand({
      version: '0.0.0-test',
      request: {
        action: 'refresh',
        providerId: previous.providerId,
        json: true,
      },
      createContext: async () => ({
        application: {
          snapshot,
          refreshCodexOAuthModels,
          syncModels,
        } as never,
        shutdown: async () => undefined,
      }),
    });

    expect(JSON.parse(output)).toEqual({
      providerId: 'custom_provider:openai-codex',
      added: 1,
      removed: 1,
      previousModelCount: 2,
      modelCount: 2,
    });
    expect(refreshCodexOAuthModels).toHaveBeenCalledOnce();
    expect(syncModels).not.toHaveBeenCalled();
  });

  it('refreshes every catalog without inference and reports one provider failure independently', async () => {
    const custom = {
      providerId: 'custom_provider:labs',
      name: 'Labs',
      kind: 'custom',
      active: false,
      enabled: true,
      readOnly: false,
      hasApiKey: true,
      models: [{ modelId: 'labs-old' }],
    } as const;
    const rejected = {
      ...custom,
      providerId: 'custom_provider:expired',
      name: 'Expired',
    } as const;
    const oauth = {
      ...custom,
      providerId: 'custom_provider:openai-codex',
      name: 'ChatGPT subscription',
      readOnly: true,
      hasApiKey: false,
      models: [{ modelId: 'gpt-old' }],
    } as const;
    const oauthCurrent = {
      ...oauth,
      models: [{ modelId: 'gpt-new' }, { modelId: 'gpt-next' }],
    } as const;
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce({
        minimaxModelSource: 'token_plan',
        providers: [custom, rejected, oauth],
      })
      .mockResolvedValueOnce({
        minimaxModelSource: 'token_plan',
        providers: [custom, rejected, oauthCurrent],
      });
    const syncModels = vi.fn(async (provider: typeof custom) => {
      if (provider.providerId === rejected.providerId) throw new Error('HTTP 401');
      return { added: 2, removed: 1, modelCount: 2 };
    });
    const refreshCodexOAuthModels = vi.fn(async () => ({
      state: 'connected' as const,
      providerId: 'openai-codex' as const,
    }));

    const output = await runMcodeProviderCommand({
      version: '0.0.0-test',
      request: { action: 'refresh', all: true, json: true },
      createContext: async () => ({
        application: {
          snapshot,
          syncModels,
          refreshCodexOAuthModels,
        } as never,
        shutdown: async () => undefined,
      }),
    });

    expect(JSON.parse(output)).toEqual({
      providers: [
        {
          providerId: custom.providerId,
          success: true,
          added: 2,
          removed: 1,
          modelCount: 2,
          previousModelCount: 1,
        },
        {
          providerId: rejected.providerId,
          success: false,
          previousModelCount: 1,
          error: 'HTTP 401',
        },
        {
          providerId: oauth.providerId,
          success: true,
          added: 2,
          removed: 1,
          modelCount: 2,
          previousModelCount: 1,
        },
      ],
      totals: { refreshed: 2, failed: 1, added: 4, removed: 2 },
    });
    expect(refreshCodexOAuthModels).toHaveBeenCalledOnce();
  });

  it('reports ChatGPT OAuth status instead of requiring a provider API key', async () => {
    const output = await runMcodeProviderCommand({
      version: '0.0.0-test',
      request: {
        action: 'test',
        providerId: 'custom_provider:openai-codex',
        modelId: 'gpt-daybreak-blue-latest',
        json: true,
      },
      createContext: async () => ({
        application: {
          getCodexOAuthStatus: vi.fn(async () => ({
            state: 'connected',
            providerId: 'openai-codex',
          })),
        } as never,
        shutdown: async () => undefined,
      }),
    });

    expect(JSON.parse(output)).toEqual({
      success: true,
      status: { state: 'connected' },
    });
  });
});
