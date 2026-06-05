import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentProfile, ElementType, Item } from "../types.js";

export interface CollisionReport {
  paths: string[];
  items: Item[];
  byType: Record<ElementType, Item[]>;
}

export type CollisionChoice = "yes" | "no" | "yes-all" | "no-all";

export type InstallResult =
  | { status: "installed" }
  | { status: "skipped"; reason: "collision-declined" }
  | { status: "failed"; reason: string };

interface FsOps {
  cpSync: typeof cpSync;
  mkdirSync: typeof mkdirSync;
}

const defaultFsOps: FsOps = { cpSync, mkdirSync };
let fsOps: FsOps = defaultFsOps;

export function _setFsOpsForTesting(ops: Partial<FsOps>): void {
  fsOps = { ...defaultFsOps, ...ops };
}

/**
 * Compute the absolute on-disk path an `item` would be installed to
 * under the profile's install base directory.
 *
 * Commands and agents are written as a single `.md` file; skills are
 * written as a directory whose name matches the item's name.
 */
function computeTarget(item: Item, profile: AgentProfile, cwd: string): string {
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

/**
 * Scan a selection of items and report which ones would overwrite an
 * existing file or directory at their target install path.
 *
 * The report is a pure read-only inspection: nothing is created or
 * modified. It is intended to be shown to the user before any install
 * actually runs.
 *
 * @param items - Items the user is about to install
 * @param profile - Agent profile (provides install paths)
 * @param cwd - Current working directory (the install root)
 * @returns The list of colliding paths, the colliding items, and a
 *          per-type breakdown for the summary screen
 */
export function collisionReport(
  items: Item[],
  profile: AgentProfile,
  cwd: string,
): CollisionReport {
  const paths: string[] = [];
  const colliding: Item[] = [];
  const byType: Record<ElementType, Item[]> = { command: [], agent: [], skill: [] };
  for (const item of items) {
    const target = computeTarget(item, profile, cwd);
    if (existsSync(target)) {
      paths.push(target);
      colliding.push(item);
      byType[item.type].push(item);
    }
  }
  return { paths, items: colliding, byType };
}

const HANDLED_ERROR_CODES = new Set(["EACCES", "EPERM", "ENOSPC"]);

/**
 * Install a single item to its target path.
 *
 * - If the user already chose `"no"` or `"no-all"` for this item, the
 *   call is a no-op and returns `"skipped"`.
 * - Otherwise the parent directory is created (recursive) and the item
 *   is copied: directories recursively, single files as-is.
 * - Known transient errors (EACCES, EPERM, ENOSPC) are converted to
 *   a structured `"failed"` result so the caller can render them; any
 *   other error is re-thrown.
 *
 * @param item - The item to install
 * @param profile - Agent profile (provides install paths)
 * @param cwd - Current working directory
 * @param choice - Pre-resolved collision choice, or null if no collision
 * @returns A structured result describing what happened
 */
export async function installItem(
  item: Item,
  profile: AgentProfile,
  cwd: string,
  choice: CollisionChoice | null,
): Promise<InstallResult> {
  if (choice === "no" || choice === "no-all") {
    return { status: "skipped", reason: "collision-declined" };
  }
  const target = computeTarget(item, profile, cwd);
  try {
    fsOps.mkdirSync(dirname(target), { recursive: true });
    if (item.isDirectory) {
      fsOps.cpSync(item.path, target, { recursive: true });
    } else {
      fsOps.cpSync(item.path, target);
    }
    return { status: "installed" };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      const code = (err as { code?: unknown }).code;
      if (typeof code === "string" && HANDLED_ERROR_CODES.has(code)) {
        const message = err instanceof Error ? err.message : String(err);
        return { status: "failed", reason: message };
      }
    }
    throw err;
  }
}

export type CollisionPrompt = (item: Item, existingPath: string) => Promise<CollisionChoice | null>;

/**
 * Install every item in `items` in order, handling collisions.
 *
 * A `"yes-all"` or `"no-all"` answer from the prompt latches a bulk
 * choice that applies to every remaining collision without further
 * prompting. A `null` answer from the prompt (user cancel) is converted
 * into a thrown `Error("User cancelled")` so the caller can abort the
 * whole run cleanly.
 *
 * @param items - Items to install, in user-confirmed order
 * @param profile - Agent profile
 * @param cwd - Current working directory
 * @param prompt - Called only when a target path already exists
 * @returns One structured result per input item, in the same order
 */
export async function installAll(
  items: Item[],
  profile: AgentProfile,
  cwd: string,
  prompt: CollisionPrompt,
): Promise<InstallResult[]> {
  const results: InstallResult[] = [];
  let bulkChoice: CollisionChoice | null = null;
  for (const item of items) {
    const target = computeTarget(item, profile, cwd);
    let choice: CollisionChoice | null;
    if (bulkChoice !== null) {
      choice = bulkChoice;
    } else if (existsSync(target)) {
      const answered = await prompt(item, target);
      if (answered === null) {
        throw new Error("User cancelled");
      }
      choice = answered;
      if (answered === "yes-all" || answered === "no-all") {
        bulkChoice = answered;
      }
    } else {
      choice = null;
    }
    results.push(await installItem(item, profile, cwd, choice));
  }
  return results;
}
