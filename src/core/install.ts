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
