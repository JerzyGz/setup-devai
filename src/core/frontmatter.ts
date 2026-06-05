import type { Frontmatter } from "../types.js";

// Matches a leading YAML frontmatter block.
// Group 1 captures the body between the opening "---" and either a closing
// "---" (on its own line) or end-of-file. Accepts both LF and CRLF line endings.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)(?:\r?\n---\r?\n?|$)/;

// Matches a top-level "key: value" line.
// Key must start with a letter or underscore (YAML identifier), followed by
// word chars or hyphens. Value is the rest of the line, untrimmed.
const KEY_VALUE_RE = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/;

// Matches a YAML block-list item ("- value") including leading whitespace.
// Group 1 captures the value text after the dash and mandatory space.
const BLOCK_ITEM_RE = /^\s*-\s+(.*)$/;

/**
 * Strip a single layer of matching surrounding double or single quotes.
 *
 * Used to clean raw values that arrived quoted in the source frontmatter
 * (e.g. `name: "commit"`). Trims whitespace before checking; leaves the
 * value untouched if the quote pair is missing or mismatched.
 */
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

/**
 * Parse an inline YAML array literal such as `[a, "b", c]`.
 *
 * @returns The parsed items (quotes stripped, blanks dropped), or null
 *          if `raw` is not a single bracketed expression.
 */
function parseInlineArray(raw: string): string[] | null {
  // Match a bracketed expression: opening "[", any body, closing "]", optional trailing whitespace.
  const match = /^\[(.*)\]\s*$/.exec(raw.trim());
  if (!match || match[1] === undefined) return null;
  return match[1]
    .split(",")
    .map((item) => stripQuotes(item))
    .filter((item) => item.length > 0);
}

/**
 * Extract the YAML frontmatter header from a markdown document.
 *
 * Supports `name`, `description`, and `requires` keys. The `requires`
 * value may be expressed either as an inline array (e.g. `[a, b]`) or
 * as a YAML block list on subsequent lines. Always returns a fully
 * populated `Frontmatter` object: missing keys fall back to empty
 * strings / empty array, never throw.
 *
 * @param markdown - The full markdown file content
 * @returns Parsed frontmatter with best-effort fallbacks
 */
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
