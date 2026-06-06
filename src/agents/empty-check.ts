import { readdirSync } from "node:fs";

export interface EmptyCheckFsOps {
  readdirSync: typeof readdirSync;
}

const defaultFsOps: EmptyCheckFsOps = { readdirSync };
let fsOps: EmptyCheckFsOps = defaultFsOps;

export function _setFsOpsForTesting(ops: Partial<EmptyCheckFsOps>): void {
  fsOps = { ...defaultFsOps, ...ops };
}

/**
 * Returns true when the given repo directory contains at least one of
 * the agent-config folder names at its top level.
 *
 * Top-level only — does not recurse. Folder names are matched
 * case-sensitively.
 *
 * @param repoPath - Absolute path to the cloned registry repo.
 * @param folderNames - The folder names the agent profile recognises
 *   (e.g. `["skills", "commands", "agents"]`).
 */
export function hasAnyAgentFolder(repoPath: string, folderNames: readonly string[]): boolean {
  const entries = fsOps.readdirSync(repoPath);
  const present = new Set(entries);
  for (const name of folderNames) {
    if (present.has(name)) return true;
  }
  return false;
}
