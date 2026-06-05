import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opencode } from "../../src/agents/opencode.ts";
import { collisionReport } from "../../src/core/install.ts";
import type { Item } from "../../src/types.ts";

function makeItem(partial: Partial<Item> & { id: string; type: Item["type"]; name: string }): Item {
  return {
    id: partial.id,
    type: partial.type,
    name: partial.name,
    description: partial.description ?? "",
    path: partial.path ?? `/tmp/${partial.id}`,
    isDirectory: partial.isDirectory ?? false,
    frontmatter: partial.frontmatter ?? {
      name: partial.name,
      description: partial.description ?? "",
      requires: [],
    },
  };
}

function mkCwd(): string {
  return mkdtempSync(join(tmpdir(), "setup-devai-install-test-"));
}

test("collisionReport: returns no paths and no items when no selections are provided", () => {
  const cwd = mkCwd();
  try {
    const report = collisionReport([], opencode, cwd);
    assert.deepEqual(report.paths, []);
    assert.deepEqual(report.items, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collisionReport: detects a command whose target file already exists", () => {
  const cwd = mkCwd();
  try {
    mkdirSync(join(cwd, ".opencode", "command"), { recursive: true });
    const target = join(cwd, ".opencode", "command", "grill-me.md");
    writeFileSync(target, "existing content\n");
    const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });

    const report = collisionReport([grillMe], opencode, cwd);

    assert.deepEqual(report.paths, [target]);
    assert.equal(report.items.length, 1);
    assert.equal(report.items[0]?.name, "grill-me");
    assert.equal(report.byType.command.length, 1);
    assert.equal(report.byType.agent.length, 0);
    assert.equal(report.byType.skill.length, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collisionReport: does not flag a command whose target file does not exist", () => {
  const cwd = mkCwd();
  try {
    const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });

    const report = collisionReport([grillMe], opencode, cwd);

    assert.deepEqual(report.paths, []);
    assert.deepEqual(report.items, []);
    assert.equal(report.byType.command.length, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collisionReport: detects an agent whose target file already exists", () => {
  const cwd = mkCwd();
  try {
    mkdirSync(join(cwd, ".opencode", "agent"), { recursive: true });
    const target = join(cwd, ".opencode", "agent", "document-writer.md");
    writeFileSync(target, "existing\n");
    const doc = makeItem({ id: "agents/document-writer", type: "agent", name: "document-writer" });

    const report = collisionReport([doc], opencode, cwd);

    assert.deepEqual(report.paths, [target]);
    assert.equal(report.items.length, 1);
    assert.equal(report.byType.agent.length, 1);
    assert.equal(report.byType.command.length, 0);
    assert.equal(report.byType.skill.length, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collisionReport: detects a skill whose target directory already exists", () => {
  const cwd = mkCwd();
  try {
    const target = join(cwd, ".opencode", "skill", "commit");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "SKILL.md"), "existing skill\n");
    const commit = makeItem({ id: "skills/commit", type: "skill", name: "commit" });

    const report = collisionReport([commit], opencode, cwd);

    assert.deepEqual(report.paths, [target]);
    assert.equal(report.items.length, 1);
    assert.equal(report.byType.skill.length, 1);
    assert.equal(report.byType.command.length, 0);
    assert.equal(report.byType.agent.length, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collisionReport: with a mixed selection of all three types, only existing targets are reported", () => {
  const cwd = mkCwd();
  try {
    const cmdTarget = join(cwd, ".opencode", "command", "grill-me.md");
    const agentTarget = join(cwd, ".opencode", "agent", "document-writer.md");
    mkdirSync(join(cwd, ".opencode", "command"), { recursive: true });
    mkdirSync(join(cwd, ".opencode", "agent"), { recursive: true });
    writeFileSync(cmdTarget, "old grill-me\n");
    writeFileSync(agentTarget, "old document-writer\n");

    const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });
    const doc = makeItem({ id: "agents/document-writer", type: "agent", name: "document-writer" });
    const minimal = makeItem({ id: "commands/minimal", type: "command", name: "minimal" });
    const commit = makeItem({ id: "skills/commit", type: "skill", name: "commit" });

    const report = collisionReport([grillMe, doc, minimal, commit], opencode, cwd);

    assert.deepEqual(report.paths.sort(), [agentTarget, cmdTarget].sort());
    assert.equal(report.items.length, 2);
    assert.equal(report.byType.command.length, 1);
    assert.equal(report.byType.command[0]?.name, "grill-me");
    assert.equal(report.byType.agent.length, 1);
    assert.equal(report.byType.agent[0]?.name, "document-writer");
    assert.equal(report.byType.skill.length, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
