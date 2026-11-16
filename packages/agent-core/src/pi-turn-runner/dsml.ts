import { randomUUID } from 'node:crypto';

import type { AssistantMessage, ToolCall } from '@earendil-works/pi-ai';

/**
 * DSML (DeepSeek Mark-up Language) leak repair.
 *
 * DeepSeek models natively emit function calls as `<｜DSML｜function calls>` text
 * markup inside their chat template. Official DeepSeek endpoints translate that
 * markup into structured tool-use blocks server-side, so a compliant client
 * never sees it (see the DeepSeek Harness reference: its wire protocol only
 * carries structured `tool_use` blocks). An OpenAI-compatible relay that skips
 * the translation lets the markup leak into the assistant text stream; the
 * model then stops to await a tool result that never arrives and the turn dies.
 *
 * This module is the client-side mitigation: detect leaked DSML markup in the
 * final AssistantMessage, recover the tool calls it describes, strip the markup
 * from visible text, and upgrade `stopReason` to `toolUse` so the normal tool
 * loop continues. It only activates when the distinctive fullwidth-bar marker
 * `｜DSML｜` (U+FF5C) is present, so other models and ordinary text are never
 * touched.
 *
 * The grammar is parsed tolerantly because real leaks add whitespace inside
 * tags (observed in the wild as `</｜DSML｜ parameter>`); canonical DeepSeek
 * output has no spaces. Parameter values follow the wire convention:
 * `string="true"` is a literal string, otherwise the value is JSON (numbers,
 * booleans, objects) with a raw-string fallback for malformed relay output.
 */

/** ASCII signature of the marker; fast pre-filter before regex work. */
const DSML_SIGNATURE = 'DSML';

const TAG_PATTERN_SOURCE =
  '<\\s*(/?)\\s*(?:\\uFF5C|\\|)\\s*DSML\\s*(?:\\uFF5C|\\|)\\s*(function\\s+calls|calls|invoke|parameter)((?:\\s+[^<>]*?)?)\\s*>';

const ATTR_PATTERN = /([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g;

export interface DsmlToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface DsmlTextRepair {
  /** True when at least one DSML tag was found in the input. */
  hadMarkup: boolean;
  /** Input with all DSML markup (and markup-owned values) removed. */
  text: string;
  /** Tool calls recovered from complete `invoke` blocks, in order. */
  toolCalls: DsmlToolCall[];
}

interface OpenInvoke {
  name: string;
  args: Record<string, unknown>;
}

interface OpenParam {
  name: string | null;
  isString: boolean;
  valueStart: number;
}

function parseAttrs(attrs: string): Map<string, string> {
  const parsed = new Map<string, string>();
  ATTR_PATTERN.lastIndex = 0;
  for (let m = ATTR_PATTERN.exec(attrs); m !== null; m = ATTR_PATTERN.exec(attrs)) {
    parsed.set(m[1].toLowerCase(), m[2]);
  }
  return parsed;
}

function parseParamValue(raw: string, isString: boolean): unknown {
  if (isString) return raw;
  const trimmed = raw.trim();
  if (trimmed === '') return raw;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

/**
 * Extract DSML tool calls from leaked markup and strip the markup from text.
 *
 * Pure and total: text outside markup regions (including stray orphan closing
 * tags, which are dropped) is preserved verbatim; unterminated invokes and
 * parameters at end-of-input are salvaged so a truncated relay stream still
 * yields the tool call when its arguments are complete.
 */
export function repairDsmlText(input: string): DsmlTextRepair {
  if (!input.includes(DSML_SIGNATURE)) {
    return { hadMarkup: false, text: input, toolCalls: [] };
  }

  const tagRe = new RegExp(TAG_PATTERN_SOURCE, 'g');
  const outParts: string[] = [];
  const toolCalls: DsmlToolCall[] = [];
  let blockOpen = false;
  let invoke: OpenInvoke | null = null;
  let param: OpenParam | null = null;
  let textCursor = 0;
  let sawMarkup = false;

  const closeInvoke = (): void => {
    if (invoke !== null) {
      if (invoke.name !== '') toolCalls.push({ name: invoke.name, args: invoke.args });
      invoke = null;
    }
  };

  for (let m = tagRe.exec(input); m !== null; m = tagRe.exec(input)) {
    const tag = m[0];
    const isClose = m[1] === '/';
    const tagName = m[2].replace(/\s+/g, ' ').trim().toLowerCase();
    const attrs = parseAttrs(m[3] ?? '');
    const tagStart = m.index;
    const tagEnd = tagStart + tag.length;

    if (param !== null) {
      // The span between a parameter's opening tag and the next tag is its
      // value; it belongs to the markup even when the parameter is orphaned.
      const value = input.slice(param.valueStart, tagStart);
      if (invoke !== null && param.name !== null) {
        invoke.args[param.name] = parseParamValue(value, param.isString);
      }
      param = null;
    } else if (!blockOpen && !invoke) {
      // Plain text between markup tags (or before the first tag) survives.
      if (tagStart > textCursor) outParts.push(input.slice(textCursor, tagStart));
    }
    textCursor = tagEnd;
    sawMarkup = true;

    if (!isClose) {
      switch (tagName) {
        case 'function calls':
        case 'calls':
          blockOpen = true;
          break;
        case 'invoke':
          // Nested open without a close: flush what we have, start fresh.
          closeInvoke();
          invoke = { name: attrs.get('name') ?? '', args: {} };
          break;
        case 'parameter':
          param = {
            name: attrs.get('name') ?? null,
            isString: attrs.get('string') === 'true',
            valueStart: tagEnd,
          };
          break;
      }
    } else {
      switch (tagName) {
        case 'function calls':
        case 'calls':
          blockOpen = false;
          break;
        case 'invoke':
          closeInvoke();
          break;
      }
    }
  }

  if (!sawMarkup) {
    return { hadMarkup: false, text: input, toolCalls: [] };
  }

  if (param !== null) {
    // Truncated stream: salvage a complete trailing value for an open invoke.
    const value = input.slice(param.valueStart);
    if (invoke !== null && param.name !== null) {
      invoke.args[param.name] = parseParamValue(value, param.isString);
    }
  } else if (!blockOpen && !invoke) {
    if (textCursor < input.length) outParts.push(input.slice(textCursor));
  }
  // Truncated stream: salvage an unterminated invoke whose arguments landed.
  closeInvoke();

  return { hadMarkup: true, text: outParts.join(''), toolCalls };
}

function defaultToolCallId(): string {
  return `dsml-${randomUUID()}`;
}

/**
 * Repair one AssistantMessage: strip leaked DSML markup from text blocks,
 * append recovered tool calls at the position of the block that carried them,
 * and upgrade `stopReason: 'stop'` to `'toolUse'` when at least one complete
 * call was recovered so the agent loop executes it. Messages without the
 * marker are returned unchanged (same object).
 */
export function repairAssistantMessageDsml(
  message: AssistantMessage,
  newToolCallId: () => string = defaultToolCallId,
): AssistantMessage {
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    return message;
  }
  if (!message.content.some((block) => block.type === 'text' && block.text.includes(DSML_SIGNATURE))) {
    return message;
  }

  let changed = false;
  const content: AssistantMessage['content'] = [];
  let recoveredCount = 0;

  for (const block of message.content) {
    if (block.type !== 'text') {
      content.push(block);
      continue;
    }
    const repair = repairDsmlText(block.text);
    if (!repair.hadMarkup) {
      content.push(block);
      continue;
    }
    changed = true;
    if (repair.text.trim().length > 0) {
      content.push({ type: 'text', text: repair.text });
    }
    for (const call of repair.toolCalls) {
      content.push({ type: 'toolCall', id: newToolCallId(), name: call.name, arguments: call.args });
      recoveredCount += 1;
    }
  }

  if (!changed) {
    return message;
  }

  const upgraded = recoveredCount > 0 && message.stopReason === 'stop';
  return {
    ...message,
    content,
    ...(upgraded ? { stopReason: 'toolUse' as const } : {}),
  };
}

export const __testing = { TAG_PATTERN_SOURCE };
