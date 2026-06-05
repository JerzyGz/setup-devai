import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentProfile, ElementType, Frontmatter, Item } from "../types.js";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * List the `.md` files in a directory, ignoring subdirectories and
 * anything that does not end in `.md`. Returns `[]` if the directory
 * does not exist (missing type dirs are treated as empty, not errors).
 */
function readMarkdownDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".md"))
    .filter((entry) => statSync(join(dir, entry)).isFile());
}

// Strip a single trailing ".md" extension to derive a fallback item name from a filename.
const MD_EXTENSION_RE = /\.md$/;

/**
 * Derive a fallback item name from a `.md` filename by stripping the
 * extension. Used when the frontmatter does not supply its own `name`.
 */
function nameFromFile(file: string): string {
  return file.replace(MD_EXTENSION_RE, "");
}

/**
 * Heuristic check for a clearly-malformed frontmatter block: the file
 * begins with a `---` line but has no matching closing `---` line. We
 * surface this as a warning and keep going with fallback values rather
 * than failing the scan, because most malformed blocks still parse to
 * something useful via `parseFrontmatter`.
 */
function isMalformedFrontmatter(content: string): boolean {
  // Opening fence: "---" at the very start of the file, followed by a line break.
  if (!/^---\r?\n/.test(content)) return false;
  const rest = content.replace(/^---\r?\n/, "");
  // Closing fence: "---" on its own line, either at start of string or after a newline,
  // followed by another line break or end of input.
  return !/(^|\r?\n)---(\r?\n|$)/.test(rest);
}

function buildItem(opts: {
  filePath: string;
  itemPath: string;
  type: ElementType;
  idPrefix: string;
  fallbackName: string;
  isDirectory: boolean;
}): Item {
  const content = readFileSync(opts.filePath, "utf8");
  if (isMalformedFrontmatter(content)) {
    process.stderr.write(
      `Warning: ${opts.filePath}: malformed frontmatter, using fallback values\n`,
    );
  }
  const frontmatter: Frontmatter = parseFrontmatter(content);
  const name = frontmatter.name.length > 0 ? frontmatter.name : opts.fallbackName;
  if (frontmatter.description.length === 0) {
    process.stderr.write(`Warning: ${opts.filePath}: missing 'description' in frontmatter\n`);
  }
  return {
    id: `${opts.idPrefix}/${name}`,
    type: opts.type,
    name,
    description: frontmatter.description,
    path: opts.itemPath,
    isDirectory: opts.isDirectory,
    frontmatter,
  };
}

/**
 * Scan a flat directory of `.md` files and emit one `Item` per file.
 *
 * Used for command and agent directories. The item `type` and `idPrefix`
 * are passed in because callers may want to override either.
 */
function scanFiles(dir: string, type: ElementType, idPrefix: string): Item[] {
  return readMarkdownDir(dir).map((file) => {
    const filePath = join(dir, file);
    return buildItem({
      filePath,
      itemPath: filePath,
      type,
      idPrefix,
      fallbackName: nameFromFile(file),
      isDirectory: false,
    });
  });
}

/**
 * Scan a directory of skill subdirectories, where each valid skill
 * directory contains a `SKILL.md` file. Subdirectories without a
 * `SKILL.md` are skipped with a stderr warning.
 */
function scanSkillDirs(dir: string, idPrefix: string): Item[] {
  if (!existsSync(dir)) return [];
  const items: Item[] = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    const skillFile = join(entryPath, "SKILL.md");
    if (!existsSync(skillFile)) {
      process.stderr.write(`Warning: skill directory '${entry}' has no SKILL.md, skipping\n`);
      continue;
    }
    items.push(
      buildItem({
        filePath: skillFile,
        itemPath: entryPath,
        type: "skill",
        idPrefix,
        fallbackName: entry,
        isDirectory: true,
      }),
    );
  }
  return items;
}

/**
 * Scan a registry checkout for all available items.
 *
 * Dispatches per-type: commands and agents are flat `.md` files in
 * their respective directories, while skills are subdirectories
 * containing a `SKILL.md`. Results are concatenated in canonical
 * order: commands, agents, skills.
 *
 * @param rootDir - Path to the cloned registry root
 * @param profile - Agent profile (provides per-type directory names)
 * @returns All discoverable items, unsorted within each type
 */
export function scan(rootDir: string, profile: AgentProfile): Item[] {
  return [
    ...scanFiles(
      join(rootDir, profile.registry.commandDir),
      "command",
      profile.registry.commandDir,
    ),
    ...scanFiles(join(rootDir, profile.registry.agentDir), "agent", profile.registry.agentDir),
    ...scanSkillDirs(join(rootDir, profile.registry.skillDir), profile.registry.skillDir),
  ];
}
