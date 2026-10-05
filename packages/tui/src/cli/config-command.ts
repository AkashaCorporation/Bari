import { existsSync } from "node:fs";
import {
  DEFAULT_BARI_AUTOMATION,
  getConfig,
  getConfigPath,
  type Config,
} from "@bari/config";

export type McodeConfigCliAction = "dump";

export interface RunMcodeConfigCommandDependencies {
  readonly readConfig?: () => Config;
  readonly readConfigPath?: () => string;
  readonly fileExists?: (path: string) => boolean;
}

/**
 * Print the configuration the runtime will actually use.
 *
 * Two things this refuses to do, both deliberately:
 *
 * - It never prints a secret. A key is reported as present plus its first
 *   characters, which is enough to tell two keys apart without leaking either.
 * - It does not claim provenance it cannot prove. A field is reported as
 *   matching or differing from its built-in default; that is a fact about the
 *   effective value, not a claim about which file set it.
 *
 * `notCovered` names what this dump cannot show. Composition-time decisions
 * (which optional services are mounted, and why one was skipped) are made in
 * code during assembly, not in configuration, so a config dump cannot answer
 * them. Saying so is better than a report that looks complete and is not.
 */
export function runMcodeConfigCommand(
  action: McodeConfigCliAction,
  dependencies: RunMcodeConfigCommandDependencies = {},
): string {
  if (action !== "dump") throw new Error(`Unknown config action: ${action}`);
  const config = (dependencies.readConfig ?? getConfig)();
  const configPath = (dependencies.readConfigPath ?? getConfigPath)();
  const fileExists = (dependencies.fileExists ?? existsSync)(configPath);

  const dump = {
    configFile: { path: configPath, exists: fileExists },
    providers: projectProviders(config),
    settings: projectSettings(config),
    automation: projectAutomation(config.automation),
    notCovered: [
      "Composition-time bindings: which optional services are mounted, and the reason one was skipped, are decided in code during assembly (see the composition notes in packages/local-runtime-v2/src/services.ts).",
      "Effective agent prompts and skills: assembled per turn from agent assets and the workspace, not from this file.",
      "Managed MiniMax catalog: derived by the runtime, never stored in configuration.",
    ],
  };
  return `${JSON.stringify(dump, null, 2)}\n`;
}

function projectProviders(config: Config) {
  const providers = readRecord(config.custom_provider);
  return Object.entries(providers)
    .map(([id, raw]) => {
      const provider = readRecord(raw);
      const options = readRecord(provider.options);
      const models = readRecord(provider.models);
      return {
        id: `custom_provider:${id}`,
        name: readString(provider.name) ?? id,
        kind: readString(provider.kind) ?? null,
        enabled: provider.enabled !== false,
        apiFormat: readString(provider.api) ?? null,
        baseUrl: readString(options.baseURL) ?? null,
        apiKey: maskSecret(options.apiKey ?? provider.apiKey),
        modelCount: Object.keys(models).length,
        models: Object.entries(models)
          .map(([modelId, modelRaw]) => projectModel(modelId, modelRaw))
          .sort((left, right) => left.id.localeCompare(right.id)),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function projectModel(id: string, raw: unknown) {
  const model = readRecord(raw);
  const limit = readRecord(model.limit);
  const thinking = readRecord(model.thinking);
  return {
    id,
    name: readString(model.name) ?? null,
    context: readNumber(limit.context),
    output: readNumber(limit.output),
    effortOptions: readStringArray(thinking.effortOptions),
    reasoning: model.reasoning === true,
    toolCall: model.tool_call === true,
  };
}

function projectSettings(config: Config) {
  return {
    defaultModel: config.defaultModel ?? null,
    defaultModelVariant: config.defaultModelVariant ?? null,
    defaultModelContextWindow: config.defaultModelContextWindow ?? null,
    defaultLightModel: config.defaultLightModel ?? null,
    permissionMode: config.permissionMode ?? null,
    minimaxModelSource: config.minimaxModelSource ?? null,
  };
}

function projectAutomation(effective: unknown) {
  const values = readRecord(effective);
  const defaults = readRecord(DEFAULT_BARI_AUTOMATION);
  const fields = [...new Set([...Object.keys(defaults), ...Object.keys(values)])].sort();
  return fields.map((field) => {
    // A field the resolved block omits falls back to its built-in default, so
    // that is the effective value. Treating absence as "differs from default"
    // would report a mismatch the runtime does not have.
    const resolved = values[field];
    const effectiveValue = resolved ?? defaults[field] ?? null;
    return {
      field,
      effective: effectiveValue,
      builtInDefault: defaults[field] ?? null,
      matchesBuiltInDefault: effectiveValue === (defaults[field] ?? null),
      presentInResolvedConfig: field in values,
    };
  });
}

/** Present plus a short prefix; never the whole value. */
function maskSecret(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return { present: false, prefix: null };
  return { present: true, prefix: value.slice(0, 8) };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : null;
}
