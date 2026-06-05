import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentProfile, ElementType, Item } from "../types.js";

export type LocalState = "not-installed" | "identical" | "differs";

const NOISE_FILE_NAMES = new Set([".DS_Store", "Thumbs.db", ".gitignore"]);

/**
 * Compute the absolute on-disk path an `item` would be installed to
 * under the profile's install base directory.
 *
 * Commands and agents are written as a single `.md` file; skills are
 * written as a directory whose name matches the item's name. This
 * function is the single source of truth for that mapping and is
 * shared between the install and the pre-check code paths so they
 * never disagree about where a given item will land.
 */
export function computeTarget(item: Item, profile: AgentProfile, cwd: string): string {
  const base = join(cwd, profile.install.baseDir);
  switch (item.type) {
    case "command":
      return join(base, profile.install.commandSubdir, `${item.name}.md`);
    case "agent":
      return join(base, profile.install.agentSubdir, `${item.name}.md`);
    case "skill":
      return join(base, profile.install.skillSubdir, item.name);
  }
}

function compareFiles(sourcePath: string, targetPath: string): boolean {
  const a = readFileSync(sourcePath);
  const b = readFileSync(targetPath);
  return a.equals(b);
}

function listRelativeFiles(rootDir: string): string[] {
  const out: string[] = [];
  function walk(dir: string, relPrefix: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (NOISE_FILE_NAMES.has(entry.name)) continue;
      if (entry.name === ".git" && entry.isDirectory()) continue;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  walk(rootDir, "");
  return out.sort();
}

function compareDirectories(sourceDir: string, targetDir: string): boolean {
  const sourceFiles = listRelativeFiles(sourceDir);
  const targetFiles = listRelativeFiles(targetDir);
  if (sourceFiles.length !== targetFiles.length) return false;
  for (let i = 0; i < sourceFiles.length; i++) {
    const rel = sourceFiles[i];
    if (rel === undefined) return false;
    if (rel !== targetFiles[i]) return false;
    if (!compareFiles(join(sourceDir, rel), join(targetDir, rel))) return false;
  }
  return true;
}

export function localState(item: Item, profile: AgentProfile, cwd: string): LocalState {
  const target = computeTarget(item, profile, cwd);
  if (!existsSync(target)) return "not-installed";
  if (!item.isDirectory) {
    return compareFiles(item.path, target) ? "identical" : "differs";
  }
  if (!existsSync(item.path)) return "differs";
  return compareDirectories(item.path, target) ? "identical" : "differs";
}

/**
 * Pick the `priorSelections` value to pass to the per-type multi-select
 * when the user enters a type.
 *
 * - If the user has already visited this type in this session
 *   (`priorByType.has(type)` is true), their last word wins: return
 *   `priorByType.get(type)` verbatim (the empty array is a meaningful
 *   "the user un-checked everything" choice, not a default).
 * - Otherwise (first visit this session), return the items of `type`
 *   whose local state is `identical` — i.e. the items the user has
 *   already installed and that still match the freshly-cloned registry
 *   byte-for-byte. Items in `not-installed` and `differs` are left
 *   unchecked, since they would either trigger a real install or a
 *   collision prompt.
 *
 * Items of other types are filtered out: the per-type prompt is
 * single-type, and the `requires` expansion within `itemMultiSelect`
 * is responsible for pulling in transitive same-type dependencies.
 */
export function priorPicksForVisit(
  stateByItem: Map<Item, LocalState>,
  type: ElementType,
  items: Item[],
  priorByType: Map<ElementType, Item[]>,
): Item[] {
  if (priorByType.has(type)) {
    return priorByType.get(type) ?? [];
  }
  return items.filter((i) => i.type === type && stateByItem.get(i) === "identical");
}
