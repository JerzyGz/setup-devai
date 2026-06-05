import * as clack from "@clack/prompts";
import type { AgentProfile, ElementType, Item } from "../types.js";
import type { CollisionReport, InstallResult } from "./install.js";

const REGISTRY_URL_PLACEHOLDER = "https://github.com/you/your-registry";

export interface UrlPromptDeps {
  text: (opts: { message: string; placeholder?: string }) => Promise<string | symbol>;
  isCancel: (value: unknown) => value is symbol;
}

const defaultDeps: UrlPromptDeps = {
  text: clack.text,
  isCancel: clack.isCancel,
};

export async function url(deps: UrlPromptDeps = defaultDeps): Promise<string> {
  for (;;) {
    const value = await deps.text({
      message: "Registry URL",
      placeholder: REGISTRY_URL_PLACEHOLDER,
    });
    if (deps.isCancel(value)) {
      throw new Error("User cancelled");
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
}

type TypeMenuValue = ElementType | "install" | "__divider__";

export interface TypeMenuDeps {
  select: typeof clack.select;
  isCancel: (value: unknown) => value is symbol;
}

const defaultTypeMenuDeps: TypeMenuDeps = {
  select: clack.select,
  isCancel: clack.isCancel,
};

const TYPE_ORDER: ElementType[] = ["command", "agent", "skill"];

export async function typeMenu(
  items: Item[],
  profile: AgentProfile,
  deps: TypeMenuDeps = defaultTypeMenuDeps,
): Promise<ElementType | "install"> {
  const typeOptions: Array<{
    value: TypeMenuValue;
    label: string;
    hint?: string;
    disabled?: boolean;
  }> = [];
  for (const type of TYPE_ORDER) {
    const count = items.filter((i) => i.type === type).length;
    if (count > 0) {
      typeOptions.push({
        value: type,
        label: `${profile.labels[type]} (${count})`,
        hint: `${count} available`,
      });
    }
  }
  const options: Array<{
    value: TypeMenuValue;
    label: string;
    hint?: string;
    disabled?: boolean;
  }> = [
    ...typeOptions,
    { value: "__divider__", label: "──────────────", disabled: true },
    { value: "install", label: "[ Install ]" },
  ];
  const result = await deps.select<TypeMenuValue>({
    message: "Choose a type",
    options,
  });
  if (deps.isCancel(result)) throw new Error("User cancelled");
  if (result === "__divider__") throw new Error("User cancelled");
  return result;
}

export interface ItemMultiSelectDeps {
  multiselect: typeof clack.multiselect;
  isCancel: (value: unknown) => value is symbol;
}

const defaultItemMultiSelectDeps: ItemMultiSelectDeps = {
  multiselect: clack.multiselect,
  isCancel: clack.isCancel,
};

export async function itemMultiSelect(
  items: Item[],
  type: ElementType,
  _profile: AgentProfile,
  priorSelections: Item[],
  deps: ItemMultiSelectDeps = defaultItemMultiSelectDeps,
): Promise<Item[]> {
  const typeItems = items.filter((i) => i.type === type);
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const initialValues: Item[] = [];
  const seenIds = new Set<string>();
  const warnedTargetIds = new Set<string>();
  const queue: Item[] = priorSelections.filter((i) => i.type === type);
  for (const seed of queue) {
    if (!seenIds.has(seed.id)) {
      seenIds.add(seed.id);
      initialValues.push(seed);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const requiredId of current.frontmatter.requires) {
      const target = itemsById.get(requiredId);
      if (!target) {
        if (!warnedTargetIds.has(requiredId)) {
          warnedTargetIds.add(requiredId);
          process.stderr.write(
            `Warning: ${current.name} requires ${requiredId} (unknown, not auto-resolved)\n`,
          );
        }
        continue;
      }
      if (target.type !== type) {
        if (!warnedTargetIds.has(requiredId)) {
          warnedTargetIds.add(requiredId);
          process.stderr.write(
            `Warning: ${current.name} requires ${requiredId} (cross-type, not auto-resolved)\n`,
          );
        }
        continue;
      }
      if (seenIds.has(target.id)) continue;
      seenIds.add(target.id);
      initialValues.push(target);
      queue.push(target);
    }
  }
  const result = await deps.multiselect<Item>({
    message: "Select items",
    options: typeItems.map((item) => ({
      value: item,
      label: item.name,
      hint: item.description,
    })),
    initialValues,
    required: false,
  });
  if (deps.isCancel(result)) throw new Error("User cancelled");
  return result;
}

export interface PreInstallSummaryDeps {
  note?: typeof clack.note;
  log?: typeof clack.log.info;
  cancel?: typeof clack.confirm;
  isCancel?: (v: unknown) => v is symbol;
}

export async function preInstallSummary(
  selections: Item[],
  collisions: CollisionReport,
  targetPath: string,
  profile: AgentProfile,
  deps: PreInstallSummaryDeps = {},
): Promise<void> {
  const log = deps.log ?? clack.log.info;
  const cancel = deps.cancel ?? clack.confirm;
  const isCancel = deps.isCancel ?? clack.isCancel;

  log(`Target: ${targetPath}`);
  log(`Selected (${selections.length}):`);
  for (const type of TYPE_ORDER) {
    const group = selections.filter((i) => i.type === type);
    if (group.length === 0) continue;
    const names = group.map((i) => i.name).join(", ");
    log(`  ${profile.labels[type]} (${group.length}): ${names}`);
  }
  log(`Collisions: ${collisions.paths.length} existing items will be overwritten`);
  for (const p of collisions.paths) {
    log(`  ${p}`);
  }
  const result = await cancel({ message: "Press Enter to continue, Ctrl+C to abort." });
  if (isCancel(result)) throw new Error("User cancelled");
}

export type CollisionChoice = "yes" | "no" | "yes-all" | "no-all";

export interface CollisionPromptDeps {
  select: typeof clack.select;
  isCancel: (v: unknown) => v is symbol;
}

const defaultCollisionPromptDeps: CollisionPromptDeps = {
  select: clack.select,
  isCancel: clack.isCancel,
};

export async function collisionPrompt(
  item: Item,
  existingPath: string,
  deps: CollisionPromptDeps = defaultCollisionPromptDeps,
): Promise<CollisionChoice | null> {
  const result = await deps.select<CollisionChoice>({
    message: `${item.name} already exists at ${existingPath}`,
    options: [
      { value: "yes", label: "Yes", hint: "Overwrite this item" },
      { value: "no", label: "No", hint: "Skip this item" },
      { value: "yes-all", label: "Yes to all", hint: "Overwrite all remaining collisions" },
      { value: "no-all", label: "No to all", hint: "Skip all remaining collisions" },
    ],
  });
  if (deps.isCancel(result)) return null;
  return result;
}

export interface PostInstallSummaryDeps {
  log?: typeof clack.log;
}

export function postInstallSummary(
  items: Item[],
  results: InstallResult[],
  targetPath: string,
  profile: AgentProfile,
  deps: PostInstallSummaryDeps = {},
): void {
  const log = deps.log ?? clack.log;
  const installed = results.filter((r) => r.status === "installed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const installedByType: Record<ElementType, number> = { command: 0, agent: 0, skill: 0 };
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const result = results[i];
    if (item && result?.status === "installed") {
      installedByType[item.type] += 1;
    }
  }
  const lines: string[] = [`Installed ${installed} items to ${targetPath}`];
  for (const type of TYPE_ORDER) {
    const count = installedByType[type];
    if (count > 0) lines.push(`  ${count} ${profile.labels[type]}`);
  }
  lines.push(`Skipped ${skipped}`);
  lines.push(`Failed ${failed}`);
  log.success(lines.join("\n"));
  if (failed > 0) {
    log.error(`${failed} item(s) failed — see above`, { output: process.stderr });
  }
}
