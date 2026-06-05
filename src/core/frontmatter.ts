import type { Frontmatter } from "../types.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)(?:\r?\n---\r?\n?|$)/;
const KEY_VALUE_RE = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/;
const BLOCK_ITEM_RE = /^\s*-\s+(.*)$/;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseInlineArray(raw: string): string[] | null {
  const match = /^\[(.*)\]\s*$/.exec(raw.trim());
  if (!match || match[1] === undefined) return null;
  return match[1]
    .split(",")
    .map((item) => stripQuotes(item))
    .filter((item) => item.length > 0);
}

export function parseFrontmatter(markdown: string): Frontmatter {
  const result: Frontmatter = { name: "", description: "", requires: [] };
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match || match[1] === undefined) return result;
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = KEY_VALUE_RE.exec(lines[i] ?? "");
    if (!kv || kv[1] === undefined) continue;
    const key = kv[1];
    const rawValue = kv[2] ?? "";
    if (key === "name") result.name = stripQuotes(rawValue);
    else if (key === "description") result.description = stripQuotes(rawValue);
    else if (key === "requires") {
      const inline = parseInlineArray(rawValue);
      if (inline !== null) {
        result.requires = inline;
        continue;
      }
      const collected: string[] = [];
      while (i + 1 < lines.length) {
        const item = BLOCK_ITEM_RE.exec(lines[i + 1] ?? "");
        if (!item || item[1] === undefined) break;
        collected.push(stripQuotes(item[1]));
        i++;
      }
      result.requires = collected;
    }
  }
  return result;
}
