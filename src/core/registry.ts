import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentProfile, ElementType, Frontmatter, Item } from "../types.js";
import { parseFrontmatter } from "./frontmatter.js";

function readMarkdownDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".md"))
    .filter((entry) => statSync(join(dir, entry)).isFile());
}

function nameFromFile(file: string): string {
  return file.replace(/\.md$/, "");
}

function isMalformedFrontmatter(content: string): boolean {
  if (!/^---\r?\n/.test(content)) return false;
  const rest = content.replace(/^---\r?\n/, "");
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
