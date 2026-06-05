import * as clack from "@clack/prompts";
import type { AgentProfile, ElementType, Item } from "../types.js";
import type { CollisionReport, InstallResult } from "./install.js";
import { customMultiselect, customSelect } from "./customPrompts.js";
import type { LocalState } from "./sync.js";

const REGISTRY_URL_PLACEHOLDER = "https://github.com/you/your-registry";

export function cropHint(hint: string, labelLength: number, columns: number): string {
  const available = columns - labelLength - 6;
  if (available >= hint.length) return hint;
  if (available <= 1) return "";
  return hint.slice(0, available - 1) + "…";
}

export interface UrlPromptDeps {
  text: (opts: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
  }) => Promise<string | symbol>;
  isCancel: (value: unknown) => value is symbol;
}

const defaultDeps: UrlPromptDeps = {
  text: clack.text,
  isCancel: clack.isCancel,
};

/**
 * Prompt the user for the registry Git URL.
 *
 * Loops until the user submits a non-empty (after trim) value. Throws
 * `"User cancelled"` if the user cancels via Ctrl+C.
 *
 * @param defaultUrl - When non-null, shown as the `defaultValue` of
 *   the prompt so the user can accept it by pressing Enter.
 */
export async function url(
  defaultUrl: string | null = null,
  deps: UrlPromptDeps = defaultDeps,
): Promise<string> {
  for (;;) {
    const value = await deps.text({
      message: "Registry URL",
      placeholder: REGISTRY_URL_PLACEHOLDER,
      defaultValue: defaultUrl ?? undefined,
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
  select: typeof customSelect;
  isCancel: (value: unknown) => value is symbol;
}

const defaultTypeMenuDeps: TypeMenuDeps = {
  select: customSelect,
  isCancel: clack.isCancel,
};

const TYPE_ORDER: ElementType[] = ["command", "agent", "skill"];

/**
 * Show a single-select menu of element types (command, agent, skill),
 * followed by a non-selectable divider and an `[ Install ]` action.
 *
 * Types with zero available items in the scanned registry are hidden.
 * The locked order is `command`, `agent`, `skill`. Throws
 * `"User cancelled"` on cancel.
 */
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
  multiselect: typeof customMultiselect;
  isCancel: (value: unknown) => value is symbol;
}

const defaultItemMultiSelectDeps: ItemMultiSelectDeps = {
  multiselect: customMultiselect,
  isCancel: clack.isCancel,
};

/**
 * Show a multi-select prompt for the items of a single type.
 *
 * Initial pre-checks come from `priorSelections` and the transitive
 * `requires` graph within that type. Cross-type and unknown `requires`
 * targets are skipped (with a one-time stderr warning per target), as
 * this prompt is single-type. The user's returned subset is returned
 * as-is (a required item can be un-checked if the user really wants to).
 *
 * When a `getState` function is provided, items whose local state is
 * `"differs"` get ` (new version available)` appended to their label
 * (label only — the hint is unchanged, and the cropHint budget from
 * the label's bare `item.name` still applies to the hint). Items in
 * `"identical"` and `"not-installed"` carry no suffix. When `getState`
 * is omitted (the default), no item receives a suffix — the function
 * is then content with whatever the caller knows.
 *
 * Throws `"User cancelled"` on cancel.
 */
export async function itemMultiSelect(
  items: Item[],
  type: ElementType,
  _profile: AgentProfile,
  priorSelections: Item[],
  deps: ItemMultiSelectDeps = defaultItemMultiSelectDeps,
  getState: (item: Item) => LocalState = () => "not-installed",
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
      label: getState(item) === "differs" ? `${item.name} (new version available)` : item.name,
      hint: cropHint(item.description, item.name.length, process.stdout.columns ?? 80),
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

/**
 * Render the pre-install summary screen and wait for the user to
 * press Enter to continue (or Ctrl+C to abort).
 *
 * Sections printed, in order:
 * 1. Target install directory
 * 2. Selected items, grouped by type in canonical order
 * 3. Collision count and the exact colliding paths
 *
 * Throws `"User cancelled"` if the user aborts at the Enter prompt.
 */
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
  select: typeof customSelect;
  isCancel: (v: unknown) => v is symbol;
}

const defaultCollisionPromptDeps: CollisionPromptDeps = {
  select: customSelect,
  isCancel: clack.isCancel,
};

/**
 * Ask the user how to handle a single target-path collision.
 *
 * Returns one of:
 * - `"yes"`     overwrite this item
 * - `"no"`      skip this item
 * - `"yes-all"` overwrite this and all remaining collisions
 * - `"no-all"`  skip this and all remaining collisions
 * - `null`      the user cancelled the prompt
 */
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

/**
 * Render the post-install summary: total installed, per-type installed
 * counts (in canonical order), a skipped count broken down by reason
 * (`already-installed` vs `collision-declined`), and a failed count.
 * Emits an `log.error` line iff at least one item failed.
 */
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
  const skippedAlreadyInstalled = results.filter(
    (r) => r.status === "skipped" && r.reason === "already-installed",
  ).length;
  const skippedCollisionDeclined = results.filter(
    (r) => r.status === "skipped" && r.reason === "collision-declined",
  ).length;
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
  lines.push(
    `Skipped ${skipped} (${skippedAlreadyInstalled} already installed, ${skippedCollisionDeclined} collisions declined)`,
  );
  lines.push(`Failed ${failed}`);
  log.success(lines.join("\n"));
  if (failed > 0) {
    log.error(`${failed} item(s) failed — see above`, { output: process.stderr });
  }
}
