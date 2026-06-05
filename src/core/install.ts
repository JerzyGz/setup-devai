import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentProfile, ElementType, Item } from "../types.js";

export interface CollisionReport {
  paths: string[];
  items: Item[];
  byType: Record<ElementType, Item[]>;
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
