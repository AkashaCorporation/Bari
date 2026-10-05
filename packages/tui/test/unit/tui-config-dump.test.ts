import { describe, expect, it, vi } from "vitest";
import type { Config } from "@bari/config";

import { runMcodeConfigCommand } from "../../src/cli/config-command.js";

const FULL_KEY = "xpl_d1973a96e81e2634794069c22940c79c83a06fa2";

function config(overrides: Partial<Config> = {}): Config {
  return {
    logLevel: "info",
    devPort: 0,
    permissionMode: "bypassPermissions",
    custom_provider: {
      explabs: {
        name: "Experiential Labs",
        kind: "custom",
        enabled: true,
        api: "openai-completions",
        options: { baseURL: "https://api.experientiallabs.ai/v1", apiKey: FULL_KEY },
        models: {
          "glm-5.3-flash": {
            name: "GLM-5.3 Flash",
            reasoning: true,
            tool_call: true,
            limit: { context: 1048576, output: 131072 },
            thinking: { effortOptions: ["low", "high", "max"] },
          },
        },
      } as never,
    },
    defaultModel: "custom_provider:explabs/glm-5.3-flash",
    // Differs from DEFAULT_BARI_AUTOMATION on purpose.
    automation: { enabled: true, maxRunsPerDay: 2 } as never,
    ...overrides,
  } as unknown as Config;
}

function dump(overrides: Partial<Config> = {}, fileExists = true) {
  return JSON.parse(
    runMcodeConfigCommand("dump", {
      readConfig: () => config(overrides),
      readConfigPath: () => "C:/fake/config.yaml",
      fileExists: () => fileExists,
    }),
  );
}

describe("bari config dump", () => {
  it("never prints a secret and still identifies the key", () => {
    const report = dump();
    const provider = report.providers[0];
    expect(provider.apiKey).toEqual({ present: true, prefix: "xpl_d197" });
    // The whole report must not contain the key beyond that prefix.
    expect(JSON.stringify(report)).not.toContain(FULL_KEY);
  });

  it("reports the config file and whether it exists", () => {
    expect(dump().configFile).toEqual({ path: "C:/fake/config.yaml", exists: true });
    expect(dump({}, false).configFile.exists).toBe(false);
  });

  it("projects providers with their models, limits and effort levels", () => {
    const provider = dump().providers[0];
    expect(provider.id).toBe("custom_provider:explabs");
    expect(provider.baseUrl).toBe("https://api.experientiallabs.ai/v1");
    expect(provider.modelCount).toBe(1);
    expect(provider.models[0]).toMatchObject({
      id: "glm-5.3-flash",
      context: 1048576,
      output: 131072,
      effortOptions: ["low", "high", "max"],
      reasoning: true,
    });
  });

  it("marks automation fields that differ from the built-in default", () => {
    const fields = Object.fromEntries(
      dump().automation.map((row: { field: string }) => [row.field, row]),
    );
    // Configured above: 2 runs per day against a default of 4.
    expect(fields.maxRunsPerDay.matchesBuiltInDefault).toBe(false);
    expect(fields.maxRunsPerDay.effective).toBe(2);
    expect(fields.maxRunsPerDay.builtInDefault).toBe(4);
    expect(fields.maxRunsPerDay.presentInResolvedConfig).toBe(true);
    // Omitted by the resolved block, so it falls back to the built-in default
    // rather than being reported as a mismatch.
    expect(fields.timeoutMs.matchesBuiltInDefault).toBe(true);
    expect(fields.timeoutMs.effective).toBe(90_000);
    expect(fields.timeoutMs.presentInResolvedConfig).toBe(false);
  });

  it("names what a config dump cannot show", () => {
    const notCovered: string[] = dump().notCovered;
    expect(notCovered.length).toBeGreaterThan(0);
    expect(notCovered.join(" ")).toContain("Composition-time bindings");
  });

  it("rejects an unknown action instead of printing a partial report", () => {
    expect(() =>
      runMcodeConfigCommand("everything" as never, { readConfig: () => config() }),
    ).toThrow(/Unknown config action/);
  });

  it("tolerates a config with no custom providers", () => {
    const report = dump({ custom_provider: undefined });
    expect(report.providers).toEqual([]);
    expect(report.settings.defaultModel).toBe("custom_provider:explabs/glm-5.3-flash");
  });
});
