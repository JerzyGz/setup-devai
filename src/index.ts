#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opencode } from "./agents/opencode.js";
import { makeCleanup } from "./core/cleanup.js";
import * as git from "./core/git.js";
import * as prompts from "./core/prompts.js";
import * as registry from "./core/registry.js";
import type { ElementType, Item } from "./types.js";

export async function main(): Promise<void> {
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
      const registryUrl = await prompts.url();
      await git.cloneShallow(registryUrl, tempDir);
      const items = registry.scan(tempDir, opencode);
      const selections = new Set<Item>();
      const priorByType = new Map<ElementType, Item[]>();
      while (true) {
        const choice = await prompts.typeMenu(items, opencode);
        if (choice === "install") break;
        const prior = priorByType.get(choice) ?? [];
        const picked = await prompts.itemMultiSelect(items, choice, opencode, prior);
        for (const existing of selections) {
          if (existing.type === choice) selections.delete(existing);
        }
        for (const item of picked) {
          selections.add(item);
        }
        priorByType.set(choice, picked);
      }
      process.stdout.write(`Selected ${selections.size} items\n`);
    }
    // further wizard steps land here in later slices
  } catch (err) {
    if (err instanceof Error && err.message === "User cancelled") {
      process.kill(process.pid, "SIGINT");
      await new Promise(() => {});
      return;
    }
    throw err;
  } finally {
    cleanupSync(tempDir);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
