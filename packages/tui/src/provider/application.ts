import type {
  McodeCodexOAuthStartResult,
  McodeCodexOAuthLoginOptions,
  McodeCodexOAuthStatus,
  McodeCreateProviderInput,
  McodeMiniMaxModelSource,
  McodeProviderRuntimePort,
  McodeProviderModel,
  McodeProviderModelInput,
  McodeSaveProviderCandidateInput,
  McodeSaveProviderCandidateResult,
  McodeProviderSnapshot,
  McodeProviderTestResult,
  McodeProviderView,
  McodeRuntimeProviderView,
  McodeUpdateProviderInput,
} from './contract.js';
import { isModelProviderApiFormat } from './contract.js';

export class McodeProviderApplication {
  constructor(private readonly port: McodeProviderRuntimePort) {}

  async snapshot(
    options: { readonly includeCodexOAuth?: boolean } = {},
  ): Promise<McodeProviderSnapshot> {
    const [customProviders, minimaxStatus, minimaxModelSource, codexOAuthStatus] =
      await Promise.all([
        this.port.listUserModelProviders(),
        this.port.getMiniMaxApiKeyStatus(),
        this.port.getMiniMaxModelSource(),
        options.includeCodexOAuth ? this.port.getCodexOAuthStatus() : undefined,
      ]);
    return {
      minimaxModelSource,
      providers: [
        ...(!codexOAuthStatus || codexOAuthStatus.state === 'hidden'
          ? []
          : [normalizeCodexOAuthProvider(codexOAuthStatus)]),
        {
          providerId: 'minimax_oauth',
          name: 'MiniMax OAuth',
          kind: 'minimax-oauth',
          active: minimaxModelSource === 'token_plan',
          enabled: true,
          readOnly: true,
          hasApiKey: false,
          models: [],
        },
        {
          providerId: 'minimax_api',
          name: 'MiniMax API Key',
          kind: 'minimax-api-key',
          active: minimaxModelSource === 'minimax_api_key',
          enabled: true,
          readOnly: false,
          hasApiKey: minimaxStatus.hasApiKey,
          ...(minimaxStatus.maskedApiKey ? { maskedApiKey: minimaxStatus.maskedApiKey } : {}),
          ...(minimaxStatus.cachedStatus ? { status: minimaxStatus.cachedStatus } : {}),
          models: [],
        },
        ...customProviders.map(normalizeCustomProvider),
      ],
    };
  }

  setMiniMaxSource(source: McodeMiniMaxModelSource): Promise<McodeMiniMaxModelSource> {
    return this.port.setMiniMaxModelSource(source);
  }

  connectCodexOAuth(options?: McodeCodexOAuthLoginOptions): Promise<McodeCodexOAuthStartResult> {
    return this.port.startCodexOAuthLogin(options);
  }

  getCodexOAuthStatus(): Promise<McodeCodexOAuthStatus> {
    return this.port.getCodexOAuthStatus();
  }

  refreshCodexOAuthModels(): Promise<McodeCodexOAuthStatus> {
    return this.port.refreshCodexOAuthModels();
  }

  cancelCodexOAuthLogin(loginId: string): Promise<McodeCodexOAuthStatus> {
    return this.port.cancelCodexOAuthLogin(loginId);
  }

  async setMiniMaxApiKey(apiKey: string, saveAndUse = true): Promise<void> {
    await this.port.upsertMiniMaxApiKey({ apiKey, saveAndUse });
  }

  async create(input: McodeCreateProviderInput): Promise<void> {
    await this.port.createUserModelProvider(input);
  }

  saveCandidate(input: McodeSaveProviderCandidateInput): Promise<McodeSaveProviderCandidateResult> {
    return this.port.saveUserModelProviderCandidate(input);
  }

  async refreshModels(provider: McodeProviderView): Promise<number> {
    const { candidate, discovered } = await this.discoverModels(provider);
    const ids = new Set(provider.models.map(({ modelId }) => modelId));
    const added = newModels(discovered, ids);
    const firstAdded = added[0];
    if (!firstAdded) return 0;
    await this.saveRefreshedModels(candidate, [
      ...provider.models.map(({ modelId }) => ({ modelId })),
      ...added,
    ], firstAdded.modelId);
    return added.length;
  }

  /** Exact live sync for explicit CLI use; manual and selected models are never pruned. */
  async syncModels(provider: McodeProviderView): Promise<{
    readonly added: number;
    readonly removed: number;
    readonly modelCount: number;
  }> {
    const { candidate, discovered } = await this.discoverModels(provider);
    // An empty discovery result is not authoritative enough to delete saved state.
    if (discovered.length === 0) {
      return { added: 0, removed: 0, modelCount: provider.models.length };
    }
    const liveIds = new Set(discovered.map(({ modelId }) => modelId.trim()).filter(Boolean));
    const kept = provider.models.filter(
      (model) =>
        model.selected === true ||
        model.configurationSource !== 'discovered' ||
        liveIds.has(model.modelId),
    );
    const ids = new Set(kept.map(({ modelId }) => modelId));
    const added = newModels(discovered, ids);
    const removed = provider.models.length - kept.length;
    if (added.length === 0 && removed === 0) {
      return { added: 0, removed: 0, modelCount: provider.models.length };
    }
    const models = [
      ...kept.map(({ modelId }) => ({ modelId })),
      ...added,
    ];
    const modelId = added[0]?.modelId ?? kept[0]?.modelId;
    if (!modelId) {
      throw new Error('Model discovery returned no safe model to retain.');
    }
    await this.saveRefreshedModels(candidate, models, modelId);
    return { added: added.length, removed, modelCount: models.length };
  }

  private async discoverModels(provider: McodeProviderView): Promise<{
    readonly candidate: {
      readonly providerId: string;
      readonly expectedRevision: string;
      readonly baseUrl: string;
    };
    readonly discovered: readonly McodeProviderModel[];
  }> {
    if (
      provider.kind !== 'custom' ||
      provider.readOnly ||
      !provider.baseUrl ||
      !provider.configRevision
    ) {
      throw new Error('Reopen /provider and select an editable connection.');
    }
    const candidate = {
      providerId: provider.providerId,
      expectedRevision: provider.configRevision,
      baseUrl: provider.baseUrl,
    };
    const discovered = await this.port.discoverUserModelsCandidate(candidate);
    return { candidate, discovered };
  }

  private async saveRefreshedModels(
    candidate: {
      readonly providerId: string;
      readonly expectedRevision: string;
      readonly baseUrl: string;
    },
    models: readonly McodeProviderModelInput[],
    modelId: string,
  ): Promise<void> {
    const result = await this.port.saveUserModelProviderCandidate({
      ...candidate,
      // IDs retain every saved model field, including disabled state and limits.
      models,
      modelId,
      skipConnectionTest: true,
      saveAndUse: false,
    });
    if (!result.success)
      throw new Error(result.status?.lastErrorMessage ?? 'Could not save refreshed models.');
  }

  async update(input: McodeUpdateProviderInput): Promise<void> {
    await this.port.updateUserModelProvider(input);
  }

  async remove(providerId: string): Promise<void> {
    await this.port.deleteUserModelProvider(providerId);
  }

  test(providerId: string, modelId?: string): Promise<McodeProviderTestResult> {
    return modelId
      ? this.port.testUserModel(providerId, modelId)
      : this.port.testUserModelProvider(providerId);
  }
}

function newModels(
  discovered: readonly McodeProviderModel[],
  ids: Set<string>,
): McodeProviderModelInput[] {
  return discovered
    .map(({ modelId, displayName }) => ({
      modelId: modelId.trim(),
      ...(displayName ? { displayName } : {}),
      configurationSource: 'discovered' as const,
    }))
    .filter(({ modelId }) => {
      if (!modelId || ids.has(modelId)) return false;
      ids.add(modelId);
      return true;
    });
}

function normalizeCodexOAuthProvider(status: McodeCodexOAuthStatus): McodeProviderView {
  return {
    providerId: status.providerId,
    name: status.displayName ?? 'OpenAI Codex',
    kind: 'codex-oauth',
    active: false,
    enabled: true,
    readOnly: true,
    hasApiKey: false,
    models: [],
    status: {
      state: status.state,
      ...(status.error ? { lastErrorMessage: status.error } : {}),
    },
  };
}

function normalizeCustomProvider(provider: McodeRuntimeProviderView): McodeProviderView {
  const apiFormat = isModelProviderApiFormat(provider.apiFormat) ? provider.apiFormat : undefined;
  return {
    providerId: provider.providerId,
    name: provider.name?.trim() || provider.providerId,
    kind: 'custom',
    // A disabled provider is never "in use": Runtime drops it from the model
    // roster (`enabledCustomProviders`) and BYOK resolution refuses it, so a
    // leftover `selected` model must not render as the active source.
    active: Boolean(
      provider.enabled !== false &&
      provider.models?.some((model) => 'selected' in model && model.selected),
    ),
    enabled: provider.enabled !== false,
    readOnly: provider.kind === 'oauth',
    ...(provider.configRevision ? { configRevision: provider.configRevision } : {}),
    ...(apiFormat ? { apiFormat } : {}),
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    hasApiKey: Boolean(provider.hasApiKey),
    ...(provider.maskedApiKey ? { maskedApiKey: provider.maskedApiKey } : {}),
    models: (provider.models ?? []).map((model) => ({
      modelId: model.modelId,
      ...(model.displayName ? { displayName: model.displayName } : {}),
      ...(model.configurationSource
        ? { configurationSource: model.configurationSource }
        : {}),
      ...(model.selected !== undefined ? { selected: model.selected } : {}),
      ...(model.status ? { status: model.status } : {}),
    })),
    ...(provider.status ? { status: provider.status } : {}),
  };
}

export type {
  McodeCreateProviderInput,
  McodeProviderRuntimePort,
  McodeProviderSnapshot,
  McodeUpdateProviderInput,
} from './contract.js';
