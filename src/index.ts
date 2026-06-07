#!/usr/bin/env node
import { mkdtempSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenCodeFolders, opencode } from "./agents/opencode.js";
import { hasAnyAgentFolder } from "./agents/empty-check.js";
import { makeCleanup } from "./core/cleanup.js";
import * as git from "./core/git.js";
import { HELP_TEXT } from "./core/help.js";
import * as install from "./core/install.js";
import * as prompts from "./core/prompts.js";
import * as registry from "./core/registry.js";
import * as state from "./core/state.js";
import { localState, priorPicksForVisit, type LocalState } from "./core/sync.js";
import type { ElementType, Item } from "./types.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export interface MainPrompts {
  url: typeof prompts.url;
  typeMenu: typeof prompts.typeMenu;
  itemMultiSelect: typeof prompts.itemMultiSelect;
  preInstallSummary: typeof prompts.preInstallSummary;
  collisionPrompt: typeof prompts.collisionPrompt;
  postInstallSummary: typeof prompts.postInstallSummary;
}

export interface MainState {
  readLastUrl: typeof state.readLastUrl;
  saveLastUrl: typeof state.saveLastUrl;
  validateRegistryUrl: typeof state.validateRegistryUrl;
}

export interface MainDeps {
  prompts?: MainPrompts;
  state?: MainState;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Main entry point for the setup-devai CLI wizard.
 *
 * Flow:
 * 1. Clone the registry into a temp directory
 * 2. Scan for available commands, agents, and skills
 * 3. Compute each item's local state (`not-installed` / `identical` /
 *    `differs`) by live-comparing the freshly-cloned registry to the
 *    current contents of `.opencode/` (see ADR 0002 — no manifest)
 * 4. Present a type menu (command/agent/skill to install)
 * 5. On the first visit to a type this session, pre-check items in
 *    state `identical`; on subsequent visits, the user's last picks
 *    for that type win (distinguishing "never visited" from
 *    "visited and un-checked everything")
 * 6. Track prior selections across type-switches
 * 7. On install, compute a collision report that excludes `identical`
 *    items, then show the pre-install summary
 * 8. Install all selected items, prompting for collisions; items in
 *    state `identical` short-circuit to a silent skip
 * 9. Show the post-install summary, breaking the skipped count down
 *    by reason (`already-installed` vs `collision-declined`)
 *
 * @param deps - Optional injected prompt dependencies for testing
 * @param argv - CLI arguments (defaults to process.argv.slice(2))
 */
export async function main(
  deps: MainDeps = {},
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return;
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write(`${version}\n`);
    return;
  }

  const p: MainPrompts = {
    url: deps.prompts?.url ?? prompts.url,
    typeMenu: deps.prompts?.typeMenu ?? prompts.typeMenu,
    itemMultiSelect: deps.prompts?.itemMultiSelect ?? prompts.itemMultiSelect,
    preInstallSummary: deps.prompts?.preInstallSummary ?? prompts.preInstallSummary,
    collisionPrompt: deps.prompts?.collisionPrompt ?? prompts.collisionPrompt,
    postInstallSummary: deps.prompts?.postInstallSummary ?? prompts.postInstallSummary,
  };
  const s: MainState = {
    readLastUrl: deps.state?.readLastUrl ?? state.readLastUrl,
    saveLastUrl: deps.state?.saveLastUrl ?? state.saveLastUrl,
    validateRegistryUrl: deps.state?.validateRegistryUrl ?? state.validateRegistryUrl,
  };
  const homeDir = deps.homeDir ?? homedir();
  const env = deps.env ?? process.env;

  const tempDir = mkdtempSync(join(tmpdir(), "setup-devai-"));

  if (!git.commandExists("git")) {
    process.stderr.write("Error: git is not installed or not in PATH.\n");
    process.exit(1);
  }

  if (process.env.SETUP_DEVAI_TEST_LOG_TEMPDIR) {
    process.stdout.write(`setup-devai-tempdir: ${tempDir}\n`);
  }

  const cleanupSync = makeCleanup();

  process.on("SIGINT", () => {
    cleanupSync(tempDir);
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanupSync(tempDir);
    process.exit(143);
  });
  process.on("uncaughtException", (err: Error) => {
    cleanupSync(tempDir);
    process.stderr.write(`${err.stack ?? err.message}\n`);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason: unknown) => {
    cleanupSync(tempDir);
    const err = reason instanceof Error ? reason : new Error(String(reason));
    process.stderr.write(`${err.stack ?? err.message}\n`);
    process.exit(1);
  });
  process.on("exit", () => {
    cleanupSync(tempDir);
  });

  try {
    const holdMs = Number(process.env.SETUP_DEVAI_TEST_HOLD_MS ?? 0);
    if (holdMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, holdMs));
    } else {
      const placeholderUrl = s.readLastUrl(homeDir, env);
      const registryUrl = await p.url(placeholderUrl);
      s.validateRegistryUrl(registryUrl);
      await git.cloneShallow(registryUrl, tempDir);
      const folderNames = Object.values(OpenCodeFolders);
      if (!hasAnyAgentFolder(tempDir, folderNames)) {
        console.log(
          `the repository ${registryUrl} doesn't have any configuration (skills, commands or agents)`,
        );
        return;
      }
      s.saveLastUrl(homeDir, env, registryUrl);
      const items = registry.scan(tempDir, opencode);
      const cwd = process.cwd();
      const targetPath = resolve(cwd, opencode.install.baseDir);
      const stateByItem = new Map<Item, LocalState>(
        items.map((item) => [item, localState(item, opencode, cwd)] as const),
      );
      const getState = (item: Item): LocalState => stateByItem.get(item) ?? "not-installed";
      const selections = new Set<Item>();
      const priorByType = new Map<ElementType, Item[]>();
      while (true) {
        const choice = await p.typeMenu(items, opencode);
        if (choice === "install") break;
        const prior = priorPicksForVisit(stateByItem, choice, items, priorByType);
        const picked = await p.itemMultiSelect(items, choice, opencode, prior, undefined, getState);
        for (const existing of selections) {
          if (existing.type === choice) selections.delete(existing);
        }
        for (const item of picked) {
          selections.add(item);
        }
        priorByType.set(choice, picked);
      }
      process.stdout.write(`Selected ${selections.size} items\n`);
      if (selections.size === 0) {
        process.stdout.write("Nothing selected. Exiting.\n");
        return;
      }
      const collisions = install.collisionReport([...selections], opencode, cwd, getState);
      await p.preInstallSummary([...selections], collisions, targetPath, opencode);
      const results = await install.installAll(
        [...selections],
        opencode,
        cwd,
        (item, existingPath) => p.collisionPrompt(item, existingPath),
        getState,
      );
      p.postInstallSummary([...selections], results, targetPath, opencode);
    }
    // further wizard steps land here in later slices
  } catch (err) {
    if (err instanceof Error && err.message === "User cancelled") {
      process.kill(process.pid, "SIGINT");
      await new Promise(() => {});
      return;
    }
    process.exitCode = 1;
  } finally {
    cleanupSync(tempDir);
  }
}

const entry = process.argv[1];
if (entry) {
  const entryReal = realpathSync(fileURLToPath(import.meta.url));
  const argvReal = realpathSync(entry);
  if (entryReal === argvReal) {
    void main();
  }
}
