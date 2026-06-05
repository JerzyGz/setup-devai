import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeFolders, opencode } from "../../src/agents/opencode.ts";
import { localState, priorPicksForVisit } from "../../src/core/sync.ts";
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
  return mkdtempSync(join(tmpdir(), "setup-devai-sync-test-"));
}

function mkSrc(): string {
  return mkdtempSync(join(tmpdir(), "setup-devai-sync-src-"));
}

test("localState: command whose target file does not exist locally returns 'not-installed'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const sourceFile = join(src, "grill-me.md");
    writeFileSync(sourceFile, "registry content\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceFile,
    });

    const state = localState(grillMe, opencode, cwd);

    assert.equal(state, "not-installed");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("localState: agent whose target file does not exist locally returns 'not-installed'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const sourceFile = join(src, "document-writer.md");
    writeFileSync(sourceFile, "registry content\n");
    const doc = makeItem({
      id: "agents/document-writer",
      type: "agent",
      name: "document-writer",
      path: sourceFile,
    });

    const state = localState(doc, opencode, cwd);

    assert.equal(state, "not-installed");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("localState: agent whose local copy is byte-for-byte identical to the registry returns 'identical'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const content = "shared agent content\n";
    const sourceFile = join(src, "document-writer.md");
    writeFileSync(sourceFile, content);
    const target = join(cwd, ".opencode", OpenCodeFolders.agents, "document-writer.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.agents), { recursive: true });
    writeFileSync(target, content);
    const doc = makeItem({
      id: "agents/document-writer",
      type: "agent",
      name: "document-writer",
      path: sourceFile,
    });

    const state = localState(doc, opencode, cwd);

    assert.equal(state, "identical");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("localState: agent whose local copy differs from the registry returns 'differs'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const sourceFile = join(src, "document-writer.md");
    writeFileSync(sourceFile, "new agent content\n");
    const target = join(cwd, ".opencode", OpenCodeFolders.agents, "document-writer.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.agents), { recursive: true });
    writeFileSync(target, "old agent content\n");
    const doc = makeItem({
      id: "agents/document-writer",
      type: "agent",
      name: "document-writer",
      path: sourceFile,
    });

    const state = localState(doc, opencode, cwd);

    assert.equal(state, "differs");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("localState: command whose local copy is byte-for-byte identical to the registry returns 'identical'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const content = "shared content for both sides\n";
    const sourceFile = join(src, "grill-me.md");
    writeFileSync(sourceFile, content);
    const target = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.commands), { recursive: true });
    writeFileSync(target, content);
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceFile,
    });

    const state = localState(grillMe, opencode, cwd);

    assert.equal(state, "identical");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("localState: command whose local copy differs from the registry returns 'differs'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const sourceFile = join(src, "grill-me.md");
    writeFileSync(sourceFile, "new content from registry\n");
    const target = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.commands), { recursive: true });
    writeFileSync(target, "old local content\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceFile,
    });

    const state = localState(grillMe, opencode, cwd);

    assert.equal(state, "differs");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("localState: skill whose target directory does not exist locally returns 'not-installed'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const skillDir = join(src, "commit");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: commit\n---\n# commit\n");
    const commit = makeItem({
      id: "skills/commit",
      type: "skill",
      name: "commit",
      path: skillDir,
      isDirectory: true,
    });

    const state = localState(commit, opencode, cwd);

    assert.equal(state, "not-installed");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("localState: skill whose target directory has byte-for-byte identical content returns 'identical'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const sourceDir = join(src, "commit");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), "---\nname: commit\n---\n# commit\n");
    writeFileSync(join(sourceDir, "helpers.js"), "module.exports = { foo: 1 };\n");
    const targetDir = join(cwd, ".opencode", OpenCodeFolders.skills, "commit");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "SKILL.md"), "---\nname: commit\n---\n# commit\n");
    writeFileSync(join(targetDir, "helpers.js"), "module.exports = { foo: 1 };\n");
    const commit = makeItem({
      id: "skills/commit",
      type: "skill",
      name: "commit",
      path: sourceDir,
      isDirectory: true,
    });

    const state = localState(commit, opencode, cwd);

    assert.equal(state, "identical");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("localState: skill whose target directory has different file content returns 'differs'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const sourceDir = join(src, "commit");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), "---\nname: commit\n---\n# commit\n");
    const targetDir = join(cwd, ".opencode", OpenCodeFolders.skills, "commit");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "SKILL.md"), "old skill content\n");
    const commit = makeItem({
      id: "skills/commit",
      type: "skill",
      name: "commit",
      path: sourceDir,
      isDirectory: true,
    });

    const state = localState(commit, opencode, cwd);

    assert.equal(state, "differs");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("localState: skill with only a .DS_Store difference between source and target returns 'identical'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const sourceDir = join(src, "commit");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), "---\nname: commit\n---\n# commit\n");
    const targetDir = join(cwd, ".opencode", OpenCodeFolders.skills, "commit");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "SKILL.md"), "---\nname: commit\n---\n# commit\n");
    writeFileSync(join(targetDir, ".DS_Store"), "macOS metadata blob\n");
    const commit = makeItem({
      id: "skills/commit",
      type: "skill",
      name: "commit",
      path: sourceDir,
      isDirectory: true,
    });

    const state = localState(commit, opencode, cwd);

    assert.equal(state, "identical");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("localState: skill with Thumbs.db and .gitignore on one side but not the other still returns 'identical'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const sourceDir = join(src, "commit");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), "---\nname: commit\n---\n# commit\n");
    const targetDir = join(cwd, ".opencode", OpenCodeFolders.skills, "commit");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "SKILL.md"), "---\nname: commit\n---\n# commit\n");
    writeFileSync(join(targetDir, "Thumbs.db"), "windows thumb cache\n");
    writeFileSync(join(targetDir, ".gitignore"), "node_modules\n");
    const commit = makeItem({
      id: "skills/commit",
      type: "skill",
      name: "commit",
      path: sourceDir,
      isDirectory: true,
    });

    const state = localState(commit, opencode, cwd);

    assert.equal(state, "identical");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("localState: skill with a .git/ directory on one side but not the other still returns 'identical'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const sourceDir = join(src, "commit");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), "---\nname: commit\n---\n# commit\n");
    const targetDir = join(cwd, ".opencode", OpenCodeFolders.skills, "commit");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "SKILL.md"), "---\nname: commit\n---\n# commit\n");
    mkdirSync(join(targetDir, ".git"), { recursive: true });
    writeFileSync(join(targetDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    const commit = makeItem({
      id: "skills/commit",
      type: "skill",
      name: "commit",
      path: sourceDir,
      isDirectory: true,
    });

    const state = localState(commit, opencode, cwd);

    assert.equal(state, "identical");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("localState: skill where the source and target differ in nested file content returns 'differs'", () => {
  const cwd = mkCwd();
  const src = mkSrc();
  try {
    const sourceNested = join(src, "commit", "lib");
    mkdirSync(sourceNested, { recursive: true });
    writeFileSync(join(src, "commit", "SKILL.md"), "---\nname: commit\n---\n# commit\n");
    writeFileSync(join(sourceNested, "core.js"), "module.exports = { v: 'new' };\n");
    const targetDir = join(cwd, ".opencode", OpenCodeFolders.skills, "commit");
    const targetNested = join(targetDir, "lib");
    mkdirSync(targetNested, { recursive: true });
    writeFileSync(join(targetDir, "SKILL.md"), "---\nname: commit\n---\n# commit\n");
    writeFileSync(join(targetNested, "core.js"), "module.exports = { v: 'old' };\n");
    const commit = makeItem({
      id: "skills/commit",
      type: "skill",
      name: "commit",
      path: join(src, "commit"),
      isDirectory: true,
    });

    const state = localState(commit, opencode, cwd);

    assert.equal(state, "differs");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("priorPicksForVisit: on first visit (no entry in priorByType), returns items of the type whose state is 'identical'", () => {
  const foo = makeItem({ id: "commands/foo", type: "command", name: "foo" });
  const bar = makeItem({ id: "commands/bar", type: "command", name: "bar" });
  const baz = makeItem({ id: "commands/baz", type: "command", name: "baz" });
  const agentX = makeItem({ id: "agents/x", type: "agent", name: "x" });
  const stateByItem = new Map<Item, "not-installed" | "identical" | "differs">([
    [foo, "identical"],
    [bar, "differs"],
    [baz, "not-installed"],
    [agentX, "identical"],
  ]);
  const priorByType = new Map<"command" | "agent" | "skill", Item[]>();

  const result = priorPicksForVisit(stateByItem, "command", [foo, bar, baz, agentX], priorByType);

  assert.deepEqual(result, [foo]);
});

test("priorPicksForVisit: on subsequent visit (entry present in priorByType), returns that entry verbatim — including an empty array", () => {
  const foo = makeItem({ id: "commands/foo", type: "command", name: "foo" });
  const bar = makeItem({ id: "commands/bar", type: "command", name: "bar" });
  const baz = makeItem({ id: "commands/baz", type: "command", name: "baz" });
  const stateByItem = new Map<Item, "not-installed" | "identical" | "differs">([
    [foo, "identical"],
    [bar, "identical"],
    [baz, "identical"],
  ]);
  const priorByType = new Map<"command" | "agent" | "skill", Item[]>([["command", [bar]]]);

  const result = priorPicksForVisit(stateByItem, "command", [foo, bar, baz], priorByType);

  assert.deepEqual(
    result,
    [bar],
    "subsequent visit returns last user picks, not the installed-identical set",
  );
});

test("priorPicksForVisit: on subsequent visit with an empty prior entry, returns the empty array (does NOT fall back to installed-identical)", () => {
  const foo = makeItem({ id: "commands/foo", type: "command", name: "foo" });
  const stateByItem = new Map<Item, "not-installed" | "identical" | "differs">([
    [foo, "identical"],
  ]);
  const priorByType = new Map<"command" | "agent" | "skill", Item[]>([["command", []]]);

  const result = priorPicksForVisit(stateByItem, "command", [foo], priorByType);

  assert.deepEqual(
    result,
    [],
    "after the user un-checks everything, the empty prior entry must be respected",
  );
});

test("priorPicksForVisit: on first visit, an item in state 'differs' is NOT pre-checked", () => {
  const foo = makeItem({ id: "commands/foo", type: "command", name: "foo" });
  const bar = makeItem({ id: "commands/bar", type: "command", name: "bar" });
  const stateByItem = new Map<Item, "not-installed" | "identical" | "differs">([
    [foo, "differs"],
    [bar, "not-installed"],
  ]);
  const priorByType = new Map<"command" | "agent" | "skill", Item[]>();

  const result = priorPicksForVisit(stateByItem, "command", [foo, bar], priorByType);

  assert.deepEqual(result, []);
});

test("priorPicksForVisit: on first visit, items of other types are filtered out", () => {
  const fooCmd = makeItem({ id: "commands/foo", type: "command", name: "foo" });
  const agentX = makeItem({ id: "agents/x", type: "agent", name: "x" });
  const skillY = makeItem({ id: "skills/y", type: "skill", name: "y" });
  const stateByItem = new Map<Item, "not-installed" | "identical" | "differs">([
    [fooCmd, "identical"],
    [agentX, "identical"],
    [skillY, "identical"],
  ]);
  const priorByType = new Map<"command" | "agent" | "skill", Item[]>();

  const result = priorPicksForVisit(stateByItem, "command", [fooCmd, agentX, skillY], priorByType);

  assert.deepEqual(result, [fooCmd]);
});
