import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opencode } from "../../src/agents/opencode.ts";
import { installAll } from "../../src/core/install.ts";
import { scan } from "../../src/core/registry.ts";
import type { Item } from "../../src/types.ts";

const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/registry");

test("install loop: scanning the fixture registry, picking all 4 items, and running installAll with 'yes-all' lands files in the right shape under <CWD>/.opencode/{command,agent,skill}", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "setup-devai-e2e-"));
  try {
    const items = scan(FIXTURE_DIR, opencode);
    const grillMe = items.find((i) => i.id === "commands/grill-me");
    const minimal = items.find((i) => i.id === "commands/minimal");
    const doc = items.find((i) => i.id === "agents/document-writer");
    const commit = items.find((i) => i.id === "skills/commit");
    assert.ok(grillMe && minimal && doc && commit, "fixture should expose the 4 expected items");

    const selections: Item[] = [grillMe, minimal, doc, commit];
    const fakePrompt = async (): Promise<"yes-all" | null> => "yes-all";
    const results = await installAll(selections, opencode, cwd, fakePrompt);

    assert.equal(results.length, 4);
    for (const r of results) {
      assert.equal(
        r.status,
        "installed",
        `expected all results to be 'installed', got: ${JSON.stringify(r)}`,
      );
    }

    assert.equal(
      existsSync(join(cwd, ".opencode", "command", "grill-me.md")),
      true,
      "command file should be installed at .opencode/command/grill-me.md",
    );
    assert.equal(
      existsSync(join(cwd, ".opencode", "command", "minimal.md")),
      true,
      "command file should be installed at .opencode/command/minimal.md",
    );
    assert.equal(
      existsSync(join(cwd, ".opencode", "agent", "document-writer.md")),
      true,
      "agent file should be installed at .opencode/agent/document-writer.md",
    );
    assert.equal(
      existsSync(join(cwd, ".opencode", "skill", "commit", "SKILL.md")),
      true,
      "skill SKILL.md should be installed at .opencode/skill/commit/SKILL.md",
    );
    assert.equal(
      existsSync(join(cwd, ".opencode", "skill", "commit", "helpers.js")),
      true,
      "skill supporting file should be copied recursively",
    );
    assert.equal(
      readFileSync(join(cwd, ".opencode", "skill", "commit", "helpers.js"), "utf8"),
      "module.exports = { foo: 1 };\n",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("install loop: with a pre-existing target, the 'no' choice leaves the file untouched and the result is 'skipped'", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "setup-devai-e2e-"));
  try {
    const items = scan(FIXTURE_DIR, opencode);
    const grillMe = items.find((i) => i.id === "commands/grill-me");
    assert.ok(grillMe);

    const target = join(cwd, ".opencode", "command", "grill-me.md");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(cwd, ".opencode", "command"), { recursive: true });
    writeFileSync(target, "EXISTING CONTENT\n");

    const fakePrompt = async (): Promise<"no" | null> => "no";
    const results = await installAll([grillMe], opencode, cwd, fakePrompt);

    assert.equal(results.length, 1);
    assert.deepEqual(results[0], { status: "skipped", reason: "collision-declined" });
    assert.equal(readFileSync(target, "utf8"), "EXISTING CONTENT\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
