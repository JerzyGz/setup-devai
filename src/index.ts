#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { opencode } from "./agents/opencode.js";
import { makeCleanup } from "./core/cleanup.js";
import * as git from "./core/git.js";
import * as install from "./core/install.js";
import * as prompts from "./core/prompts.js";
import * as registry from "./core/registry.js";
import type { ElementType, Item } from "./types.js";

export interface MainPrompts {
  url: typeof prompts.url;
  typeMenu: typeof prompts.typeMenu;
  itemMultiSelect: typeof prompts.itemMultiSelect;
  preInstallSummary: typeof prompts.preInstallSummary;
  collisionPrompt: typeof prompts.collisionPrompt;
  postInstallSummary: typeof prompts.postInstallSummary;
}

export interface MainDeps {
  prompts?: MainPrompts;
}

export async function main(deps: MainDeps = {}): Promise<void> {
  const p: MainPrompts = {
    url: deps.prompts?.url ?? prompts.url,
    typeMenu: deps.prompts?.typeMenu ?? prompts.typeMenu,
    itemMultiSelect: deps.prompts?.itemMultiSelect ?? prompts.itemMultiSelect,
    preInstallSummary: deps.prompts?.preInstallSummary ?? prompts.preInstallSummary,
    collisionPrompt: deps.prompts?.collisionPrompt ?? prompts.collisionPrompt,
    postInstallSummary: deps.prompts?.postInstallSummary ?? prompts.postInstallSummary,
  };

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
      const registryUrl = await p.url();
      await git.cloneShallow(registryUrl, tempDir);
      const items = registry.scan(tempDir, opencode);
      const selections = new Set<Item>();
      const priorByType = new Map<ElementType, Item[]>();
      while (true) {
        const choice = await p.typeMenu(items, opencode);
        if (choice === "install") break;
        const prior = priorByType.get(choice) ?? [];
        const picked = await p.itemMultiSelect(items, choice, opencode, prior);
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
      const cwd = process.cwd();
      const targetPath = resolve(cwd, opencode.install.baseDir);
      const collisions = install.collisionReport([...selections], opencode, cwd);
      await p.preInstallSummary([...selections], collisions, targetPath, opencode);
      const results = await install.installAll(
        [...selections],
        opencode,
        cwd,
        (item, existingPath) => p.collisionPrompt(item, existingPath),
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

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
