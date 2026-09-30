/**
 * Natural-language Goal activation.
 *
 * `/goal <objective>` is the explicit path. This detector covers the
 * conversational forms the product already teaches — "vamos subir isso com
 * goal", "fazer no goal", "use goal", "goal mode" — where the message names
 * Goal as the working mode and the rest of the message becomes the objective.
 *
 * Deliberately conservative:
 * - `goal` must appear inside a trigger phrase (or as a leading `goal:` label),
 *   so ordinary prose ("the goal of this function") never matches;
 * - the trigger phrase must sit at the START or the END of the message, so a
 *   mid-sentence mention ("vamos fazer isso com goal e depois testar") is never
 *   hijacked into a Goal kickoff;
 * - a leading trigger must end at a boundary (punctuation or a `to`/`para`
 *   connector), so "com goal tracking melhorar X" stays normal work.
 *
 * Callers must additionally confirm that no Goal is active before creating
 * one; this module only recognises intent, it never authorises anything.
 */

/** `goal: implementar X` at the top of a message is an explicit label. */
const LEADING_GOAL_LABEL_RE = /^\s*goal\s*[:：]\s+/iu;

const GOAL_TRIGGER_PATTERN = [
  '\\bcom\\s+(?:o\\s+)?goal(?:\\s+mode)?\\b',
  '\\bcomo\\s+goal\\b',
  '\\bno\\s+(?:modo\\s+)?goal\\b',
  '\\bmodo\\s+goal\\b',
  '\\bgoal\\s+mode\\b',
  '\\b(?:use|usar|usando|using|with|via|as\\s+a)\\s+goal(?:\\s+mode)?\\b',
].join('|');

const TRAILING_SEPARATOR_RE = /^[\s:,.!?…、。！，：；？—–-]*$/u;
const PREFIX_SEPARATOR_RE = /^\s*[:：，,、。！？；…—–-]/u;
const PREFIX_CONNECTOR_RE = /^\s+(?:to|para)\s+/iu;

const EDGE_PUNCTUATION = /^[\s:,.!?…、。！，：；？—–-]+|[\s:,.!?…、。！，：；？—–-]+$/gu;

export interface TuiThreadGoalIntent {
  /** Objective text for the new Goal; never empty. */
  readonly objective: string;
}

/**
 * Recognise an implicit Goal kickoff in a user message.
 *
 * Returns the message with the trigger phrase removed so "vamos subir isso com
 * goal" yields the objective "vamos subir isso", and "com goal: implementar X"
 * yields "implementar X". When the trigger phrase is the whole message, the
 * full text is kept as the objective so the Goal is never created empty.
 */
export function detectTuiThreadGoalIntent(raw: string): TuiThreadGoalIntent | undefined {
  const text = raw.trim();
  if (!text) return undefined;

  const leading = LEADING_GOAL_LABEL_RE.exec(text);
  if (leading) {
    const objective = text.slice(leading[0].length).replace(EDGE_PUNCTUATION, '').trim();
    return objective ? { objective } : undefined;
  }

  const matches = [...text.matchAll(new RegExp(GOAL_TRIGGER_PATTERN, 'giu'))];
  const match = matches.find((candidate) => {
    const remainder = text.slice(candidate.index + candidate[0].length);
    const endsMessage = TRAILING_SEPARATOR_RE.test(remainder);
    const startsMessage =
      candidate.index === 0 &&
      (remainder === '' ||
        PREFIX_SEPARATOR_RE.test(remainder) ||
        PREFIX_CONNECTOR_RE.test(remainder));
    return endsMessage || startsMessage;
  });
  if (!match) return undefined;

  const objective = (
    text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length)
  )
    .replace(EDGE_PUNCTUATION, '')
    .trim();
  return { objective: objective || text };
}
