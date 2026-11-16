import { describe, expect, it } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
  repairAssistantMessageDsml,
  repairDsmlText,
} from "../../../src/pi-turn-runner/dsml.js";
import { withDsmlRepair } from "../../../src/pi-turn-runner/llm.js";

const BAR = "\uFF5C"; // ｜ fullwidth vertical line in DeepSeek's DSML marker

function dsml(fragment: string): string {
  return `${BAR}DSML${BAR}${fragment}`;
}

// Canonical DeepSeek function-call block exactly as emitted by the official
// chat template: two invokes, one string and one JSON parameter.
const CANONICAL_BLOCK = [
  `<${dsml("function calls")}>`,
  `<${dsml('invoke name="read_file" id="call_1"')}>`,
  `<${dsml('parameter name="path" string="true"')}>/tmp/a.txt</${dsml("parameter")}>`,
  `<${dsml('parameter name="limit" string="false"')}>10</${dsml("parameter")}>`,
  `</${dsml("invoke")}>`,
  `<${dsml('invoke name="note"')}>`,
  `<${dsml('parameter name="description" string="true"')}>fix note</${dsml("parameter")}>`,
  `</${dsml("invoke")}>`,
  `</${dsml("calls")}>`,
].join("");

// The leak observed in the wild through a non-translating relay: the block
// opener never reaches the client, whitespace appears inside closing tags,
// and a stray parameter block sits between orphan closers.
const LEAKED_TAIL = [
  "Vou corrigir o offset.",
  `</${dsml(" parameter")}>`,
  `<${dsml(' parameter name="description" string="true"')}>fix note</${dsml(" parameter")}>`,
  `</${dsml(" invoke")}>`,
  `</${dsml(" calls")}>`,
].join("\n");

function fakeModel(provider = "fake-provider"): Model<any> {
  return {
    id: "fake-model",
    name: "fake-model",
    api: "test-messages",
    provider,
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8_192,
  } as Model<any>;
}

const CONTEXT: Context = { messages: [] };

function assistant(
  stopReason: AssistantMessage["stopReason"],
  content: AssistantMessage["content"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "fake-provider",
    model: "deepseek-experimental",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 1_700_000_000_000,
  };
}

describe("repairDsmlText", () => {
  it("returns text unchanged when no markup is present", () => {
    const input = "Vou ler o arquivo agora |DSML| e depois continuo.";
    const result = repairDsmlText(input);
    expect(result.hadMarkup).toBe(false);
    expect(result.text).toBe(input);
    expect(result.toolCalls).toEqual([]);
  });

  it("recovers tool calls from a canonical block and strips the markup", () => {
    const result = repairDsmlText(`Vou ler o arquivo.\n${CANONICAL_BLOCK}\nPronto.`);
    expect(result.hadMarkup).toBe(true);
    expect(result.text).toBe("Vou ler o arquivo.\n\nPronto.");
    expect(result.toolCalls).toEqual([
      { name: "read_file", args: { path: "/tmp/a.txt", limit: 10 } },
      { name: "note", args: { description: "fix note" } },
    ]);
  });

  it("tolerates whitespace inside tags and parses JSON parameters", () => {
    const block = [
      `<${dsml(" function calls")}>`,
      `<${dsml(' invoke name="search"')}>`,
      `<${dsml(' parameter name="opts" string="false"')}>{"deep":true}</${dsml(" parameter")}>`,
      `</${dsml(" invoke")}>`,
      `</${dsml(" calls")}>`,
    ].join("");
    const result = repairDsmlText(block);
    expect(result.toolCalls).toEqual([{ name: "search", args: { opts: { deep: true } } }]);
    expect(result.text).toBe("");
  });

  it("strips orphan closing tags without inventing tool calls", () => {
    const result = repairDsmlText(LEAKED_TAIL);
    expect(result.hadMarkup).toBe(true);
    expect(result.toolCalls).toEqual([]);
    // Whitespace that separated the removed tags stays; the tags do not.
    expect(result.text).toBe("Vou corrigir o offset.\n\n\n\n");
  });

  it("salvages a completed invoke from a truncated stream", () => {
    const truncated = [
      `<${dsml("function calls")}>`,
      `<${dsml('invoke name="read_file"')}>`,
      `<${dsml('parameter name="path" string="true"')}>/x</${dsml("parameter")}>`,
      `</${dsml("invoke")}>`,
    ].join("");
    const result = repairDsmlText(truncated);
    expect(result.toolCalls).toEqual([{ name: "read_file", args: { path: "/x" } }]);
    expect(result.text).toBe("");
  });

  it("falls back to the raw string when a non-string parameter is not valid JSON", () => {
    const block = [
      `<${dsml("function calls")}>`,
      `<${dsml('invoke name="note"')}>`,
      `<${dsml('parameter name="description" string="false"')}>fix note</${dsml("parameter")}>`,
      `</${dsml("invoke")}>`,
      `</${dsml("calls")}>`,
    ].join("");
    const result = repairDsmlText(block);
    expect(result.toolCalls).toEqual([{ name: "note", args: { description: "fix note" } }]);
  });
});

describe("repairAssistantMessageDsml", () => {
  it("upgrades stop to toolUse, keeps thinking, and appends recovered tool calls", () => {
    const message = assistant("stop", [
      { type: "thinking", thinking: "preciso ler o arquivo" },
      { type: "text", text: `Vou ler.\n${CANONICAL_BLOCK}` },
    ]);
    let seq = 0;
    const repaired = repairAssistantMessageDsml(message, () => `fixed-${seq++}`);

    expect(repaired.stopReason).toBe("toolUse");
    expect(repaired.usage).toEqual(message.usage);
    expect(repaired.model).toBe(message.model);

    expect(repaired.content[0]).toEqual({ type: "thinking", thinking: "preciso ler o arquivo" });
    expect(repaired.content[1]).toEqual({ type: "text", text: "Vou ler.\n" });
    const calls = repaired.content.filter((block) => block.type === "toolCall");
    expect(calls).toEqual([
      { type: "toolCall", id: "fixed-0", name: "read_file", arguments: { path: "/tmp/a.txt", limit: 10 } },
      { type: "toolCall", id: "fixed-1", name: "note", arguments: { description: "fix note" } },
    ]);
  });

  it("cleans leaked text without recovering calls and keeps stop", () => {
    const repaired = repairAssistantMessageDsml(assistant("stop", [{ type: "text", text: LEAKED_TAIL }]));
    expect(repaired.stopReason).toBe("stop");
    expect(repaired.content).toEqual([{ type: "text", text: "Vou corrigir o offset.\n\n\n\n" }]);
  });

  it("returns the same object when the marker is absent", () => {
    const message = assistant("stop", [{ type: "text", text: "resposta comum" }]);
    expect(repairAssistantMessageDsml(message)).toBe(message);
  });

  it("leaves error and aborted messages untouched", () => {
    const errored = assistant("error", [{ type: "text", text: LEAKED_TAIL }]);
    expect(repairAssistantMessageDsml(errored)).toBe(errored);
    const aborted = assistant("aborted", [{ type: "text", text: LEAKED_TAIL }]);
    expect(repairAssistantMessageDsml(aborted)).toBe(aborted);
  });

  it("cleans leaked text on an already toolUse message without changing the reason", () => {
    const message = assistant("toolUse", [{ type: "text", text: `checando.\n${LEAKED_TAIL}` }]);
    const repaired = repairAssistantMessageDsml(message);
    expect(repaired.stopReason).toBe("toolUse");
    expect(repaired.content).toEqual([{ type: "text", text: "checando.\nVou corrigir o offset.\n\n\n\n" }]);
  });
});

describe("withDsmlRepair", () => {
  function streamOf(events: AssistantMessageEvent[]): StreamFn {
    return (() => {
      const stream = createAssistantMessageEventStream();
      for (const event of events) stream.push(event);
      return stream;
    }) as StreamFn;
  }

  it("rewrites the done event so the loop sees a toolUse message", async () => {
    const leaky = assistant("stop", [{ type: "text", text: CANONICAL_BLOCK }]);
    const start: AssistantMessageEvent = {
      type: "start",
      partial: assistant("stop", []),
    };
    const done: AssistantMessageEvent = { type: "done", message: leaky, reason: "stop" };

    const stream = withDsmlRepair(streamOf([start, done]))(fakeModel(), CONTEXT);
    const seen: AssistantMessageEvent[] = [];
    for await (const event of stream) seen.push(event);

    expect(seen.map((event) => event.type)).toEqual(["start", "done"]);
    const final = await stream.result();
    expect(final.stopReason).toBe("toolUse");
    expect(final.content.filter((block) => block.type === "toolCall")).toHaveLength(2);
  });

  it("forwards clean messages unchanged", async () => {
    const clean = assistant("stop", [{ type: "text", text: "tudo certo" }]);
    const done: AssistantMessageEvent = { type: "done", message: clean, reason: "stop" };
    const final = await withDsmlRepair(streamOf([done]))(fakeModel(), CONTEXT).result();
    expect(final).toBe(clean);
  });

  it("passes protocol error events through untouched", async () => {
    const errored = assistant("error", []);
    const errorEvent: AssistantMessageEvent = { type: "error", reason: "error", error: errored };
    const final = await withDsmlRepair(streamOf([errorEvent]))(fakeModel(), CONTEXT).result();
    expect(final).toBe(errored);
  });

  it("encodes a synchronously throwing transport as a protocol error", async () => {
    const throwing = (() => {
      throw new Error("transport caiu");
    }) as unknown as StreamFn;
    const final = await withDsmlRepair(throwing)(fakeModel(), CONTEXT).result();
    expect(final.stopReason).toBe("error");
    expect(final.errorMessage).toContain("transport caiu");
  });
});
