import { createHash } from "node:crypto";

export interface LearningEvidence {
  id: string;
  messageId: string;
  role: string;
  text: string;
  hash: string;
}
export interface LearningAsset {
  kind: "memory" | "skill";
  target: string;
  text: string | null;
  hash: string;
}
export interface LearningProposal {
  kind: "memory" | "skill";
  target: string;
  operation: "append" | "edit" | "write";
  text: string;
  oldText?: string;
  evidence: Array<{ id: string; quote: string }>;
}
export const LEARNING_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["changes"],
  properties: {
    changes: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "target", "operation", "text", "evidence"],
        properties: {
          kind: { type: "string", enum: ["memory", "skill"] },
          target: { type: "string" },
          operation: { type: "string", enum: ["append", "edit", "write"] },
          text: { type: "string", maxLength: 12000 },
          oldText: { type: "string", maxLength: 12000 },
          evidence: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "quote"],
              properties: {
                id: { type: "string" },
                quote: { type: "string", minLength: 16, maxLength: 500 },
              },
            },
          },
        },
      },
    },
  },
} as const;

export function assetHash(text: string | null): string {
  return createHash("sha256")
    .update(text === null ? "missing\0" : `text\0${text}`)
    .digest("hex");
}

export function validateLearningProposals(
  raw: unknown,
  input: {
    evidence: readonly LearningEvidence[];
    assets: readonly LearningAsset[];
    dream: boolean;
    distill: boolean;
    existingSkillNames: readonly string[];
  },
): Array<{ proposal: LearningProposal; before: LearningAsset; after: string }> {
  if (
    !raw ||
    typeof raw !== "object" ||
    Object.keys(raw).some((key) => key !== "changes") ||
    !Array.isArray((raw as { changes?: unknown }).changes)
  )
    throw new Error("Invalid proposal object");
  const changes = (raw as { changes: unknown[] }).changes;
  if (changes.length > 2) throw new Error("Too many learning changes");
  const seen = new Set<string>();
  return changes
    .map((value) => {
      if (!value || typeof value !== "object")
        throw new Error("Invalid learning change");
      const p = value as LearningProposal;
      if (
        Object.keys(p).some(
          (key) =>
            ![
              "kind",
              "target",
              "operation",
              "text",
              "oldText",
              "evidence",
            ].includes(key),
        ) ||
        !["memory", "skill"].includes(p.kind) ||
        !["append", "edit", "write"].includes(p.operation) ||
        typeof p.target !== "string" ||
        typeof p.text !== "string" ||
        Buffer.byteLength(p.text) > 16000 ||
        Buffer.from(p.text).toString("utf8") !== p.text ||
        !Array.isArray(p.evidence) ||
        p.evidence.length > 4
      )
        throw new Error("Invalid learning fields");
      if (
        (p.kind === "memory" && !input.dream) ||
        (p.kind === "skill" && !input.distill)
      )
        throw new Error("Learning kind disabled");
      const key = `${p.kind}:${p.target}`;
      if (seen.has(key)) throw new Error("Duplicate learning target");
      seen.add(key);
      const references = new Set<string>();
      for (const ref of p.evidence) {
        const source = input.evidence.find((e) => e.id === ref?.id);
        if (
          !source ||
          !["user", "toolResult", "tool"].includes(source.role) ||
          typeof ref.quote !== "string" ||
          ref.quote.length < 16 ||
          ref.quote.length > 500 ||
          !source.text.includes(ref.quote)
        )
          throw new Error("Unsupported learning evidence");
        references.add(source.messageId);
      }
      if (references.size < (p.kind === "skill" ? 2 : 1) || references.size > 4)
        throw new Error("Insufficient independent learning evidence");
      if (
        p.kind === "memory" &&
        p.target !== "main" &&
        !/^topic:[a-z0-9][a-z0-9_-]{0,63}$/.test(p.target)
      )
        throw new Error("Invalid memory target");
      if (
        p.kind === "skill" &&
        !/^learned-[a-z0-9][a-z0-9-]{1,47}$/.test(p.target)
      )
        throw new Error("Invalid managed skill name");
      const before = input.assets.find(
        (asset) => `${asset.kind}:${asset.target}` === key,
      ) ?? {
        kind: p.kind,
        target: p.target,
        text: null,
        hash: assetHash(null),
      };
      if (
        p.kind === "skill" &&
        before.text === null &&
        input.existingSkillNames.includes(p.target)
      )
        throw new Error("Existing skill owns this name");
      if (p.kind === "skill" && p.operation !== "write")
        throw new Error("Skills require complete Markdown");
      let after = p.text;
      if (p.operation === "append")
        after = `${before.text ?? ""}${before.text ? "\n\n" : ""}${p.text}`;
      if (p.operation === "edit") {
        if (
          !before.text ||
          typeof p.oldText !== "string" ||
          !p.oldText ||
          before.text.split(p.oldText).length !== 2
        )
          throw new Error("Memory edit must match exactly once");
        const offset = before.text.indexOf(p.oldText);
        after =
          before.text.slice(0, offset) +
          p.text +
          before.text.slice(offset + p.oldText.length);
      }
      if (
        Buffer.byteLength(after) > 32 * 1024 ||
        after.split("\n").length > 400
      )
        throw new Error("Learning asset exceeds its bound");
      if (
        /(?:-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[a-zA-Z0-9._-]{12,}|\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^\s"']{12,}|\bsk-[a-zA-Z0-9_-]{20,})/i.test(
          after,
        )
      )
        throw new Error("Sensitive learning content");
      if (p.kind === "skill") {
        // The managed format has exactly two plain frontmatter fields. In
        // particular, model output cannot declare tool or permission overrides.
        const header = after.match(
          /^---\nname: ([a-z0-9-]+)\ndescription: ([^\n]{12,500})\n---\n/,
        );
        if (
          !header ||
          header[1] !== p.target ||
          /[:\[\]{}&*!|>]/.test(header[2]!)
        )
          throw new Error(
            "Managed skill requires plain name/description frontmatter",
          );
      }
      return { proposal: p, before, after };
    })
    .filter((change) => change.before.text !== change.after);
}
