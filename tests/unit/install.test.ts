import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeFolders, opencode } from "../../src/agents/opencode.ts";
import {
  _setFsOpsForTesting,
  collisionReport,
  installAll,
  installItem,
} from "../../src/core/install.ts";
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
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.commands), { recursive: true });
    const target = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
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
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.agents), { recursive: true });
    const target = join(cwd, ".opencode", OpenCodeFolders.agents, "document-writer.md");
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
    const target = join(cwd, ".opencode", OpenCodeFolders.skills, "commit");
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
    const cmdTarget = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
    const agentTarget = join(cwd, ".opencode", OpenCodeFolders.agents, "document-writer.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.commands), { recursive: true });
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.agents), { recursive: true });
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

test("collisionReport: excludes items whose local state is 'identical' — even though their target exists on disk", () => {
  const cwd = mkCwd();
  try {
    const grillTarget = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
    const docTarget = join(cwd, ".opencode", OpenCodeFolders.agents, "document-writer.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.commands), { recursive: true });
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.agents), { recursive: true });
    writeFileSync(grillTarget, "old grill-me — differs\n");
    writeFileSync(docTarget, "old document-writer — identical to what caller will say\n");
    const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });
    const doc = makeItem({ id: "agents/document-writer", type: "agent", name: "document-writer" });

    const report = collisionReport([grillMe, doc], opencode, cwd, (item) =>
      item.id === "agents/document-writer" ? "identical" : "differs",
    );

    assert.deepEqual(report.paths, [grillTarget]);
    assert.deepEqual(report.items, [grillMe]);
    assert.equal(report.byType.command.length, 1);
    assert.equal(
      report.byType.agent.length,
      0,
      "identical agent must be excluded from the per-type breakdown",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collisionReport: when getState is not provided, all existing targets are reported (back-compat)", () => {
  const cwd = mkCwd();
  try {
    const grillTarget = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
    const docTarget = join(cwd, ".opencode", OpenCodeFolders.agents, "document-writer.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.commands), { recursive: true });
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.agents), { recursive: true });
    writeFileSync(grillTarget, "old grill-me\n");
    writeFileSync(docTarget, "old document-writer\n");
    const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });
    const doc = makeItem({ id: "agents/document-writer", type: "agent", name: "document-writer" });

    const report = collisionReport([grillMe, doc], opencode, cwd);

    assert.deepEqual(report.paths.sort(), [grillTarget, docTarget].sort());
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("installItem: copies a single file to its target path and returns 'installed'", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-install-src-"));
  try {
    const sourceFile = join(sourceDir, "grill-me.md");
    writeFileSync(sourceFile, "fresh grill-me content\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceFile,
    });

    const result = await installItem(grillMe, opencode, cwd, null);

    assert.deepEqual(result, { status: "installed" });
    const target = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
    assert.equal(readFileSync(target, "utf8"), "fresh grill-me content\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installItem: returns 'skipped' with reason 'collision-declined' when choice is 'no'", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-install-src-"));
  try {
    const sourceFile = join(sourceDir, "grill-me.md");
    writeFileSync(sourceFile, "should not be copied\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceFile,
    });

    const result = await installItem(grillMe, opencode, cwd, "no");

    assert.deepEqual(result, { status: "skipped", reason: "collision-declined" });
    assert.equal(
      existsSync(join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md")),
      false,
      "no file should have been created when choice is 'no'",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installItem: returns 'skipped' with reason 'collision-declined' when choice is 'no-all'", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-install-src-"));
  try {
    const sourceFile = join(sourceDir, "grill-me.md");
    writeFileSync(sourceFile, "should not be copied\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceFile,
    });

    const result = await installItem(grillMe, opencode, cwd, "no-all");

    assert.deepEqual(result, { status: "skipped", reason: "collision-declined" });
    assert.equal(
      existsSync(join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md")),
      false,
      "no file should have been created when choice is 'no-all'",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installItem: copies a directory tree (skill with supporting files) to its target dir", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-install-skill-src-"));
  try {
    const skillDir = join(sourceDir, "commit");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: commit\ndescription: A test skill\n---\n# commit\n",
    );
    writeFileSync(join(skillDir, "helpers.js"), "module.exports = { foo: 1 };");
    const commit = makeItem({
      id: "skills/commit",
      type: "skill",
      name: "commit",
      path: skillDir,
      isDirectory: true,
    });

    const result = await installItem(commit, opencode, cwd, null);

    assert.deepEqual(result, { status: "installed" });
    const targetDir = join(cwd, ".opencode", OpenCodeFolders.skills, "commit");
    assert.equal(
      readFileSync(join(targetDir, "SKILL.md"), "utf8"),
      "---\nname: commit\ndescription: A test skill\n---\n# commit\n",
    );
    assert.equal(
      readFileSync(join(targetDir, "helpers.js"), "utf8"),
      "module.exports = { foo: 1 };",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installItem: creates the .opencode/<type>/ parent directory hierarchy when it does not exist", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-install-parent-"));
  try {
    assert.equal(
      existsSync(join(cwd, ".opencode")),
      false,
      "precondition: .opencode/ should not exist before install",
    );
    const sourceFile = join(sourceDir, "document-writer.md");
    writeFileSync(sourceFile, "agent content\n");
    const doc = makeItem({
      id: "agents/document-writer",
      type: "agent",
      name: "document-writer",
      path: sourceFile,
    });

    const result = await installItem(doc, opencode, cwd, null);

    assert.deepEqual(result, { status: "installed" });
    const target = join(cwd, ".opencode", OpenCodeFolders.agents, "document-writer.md");
    assert.equal(existsSync(target), true);
    assert.equal(readFileSync(target, "utf8"), "agent content\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installItem: returns 'failed' with a descriptive reason when the target parent dir is read-only (EACCES)", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-install-eacces-"));
  try {
    const targetParent = join(cwd, ".opencode", OpenCodeFolders.commands);
    mkdirSync(targetParent, { recursive: true });
    chmodSync(targetParent, 0o555);
    const sourceFile = join(sourceDir, "grill-me.md");
    writeFileSync(sourceFile, "content\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceFile,
    });

    const result = await installItem(grillMe, opencode, cwd, null);

    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.match(result.reason, /EACCES/);
    }
  } finally {
    chmodSync(join(cwd, ".opencode", OpenCodeFolders.commands), 0o755);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installItem: returns 'failed' with a descriptive reason when fs throws EPERM (e.g. SIP-protected system path)", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-install-eperm-"));
  try {
    const sourceFile = join(sourceDir, "grill-me.md");
    writeFileSync(sourceFile, "content\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceFile,
    });
    _setFsOpsForTesting({
      cpSync: () => {
        const err = new Error("EPERM: operation not permitted, copyfile") as Error & {
          code: string;
        };
        err.code = "EPERM";
        throw err;
      },
    });

    try {
      const result = await installItem(grillMe, opencode, cwd, null);

      assert.equal(result.status, "failed");
      if (result.status === "failed") {
        assert.match(result.reason, /EPERM/);
        assert.match(result.reason, /operation not permitted/);
      }
    } finally {
      _setFsOpsForTesting({});
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installItem: returns 'failed' with a descriptive reason when fs throws ENOSPC (test seam)", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-install-enospc-"));
  try {
    const sourceFile = join(sourceDir, "grill-me.md");
    writeFileSync(sourceFile, "content\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceFile,
    });
    _setFsOpsForTesting({
      cpSync: () => {
        const err = new Error("ENOSPC: no space left on device, copyfile") as Error & {
          code: string;
        };
        err.code = "ENOSPC";
        throw err;
      },
    });

    try {
      const result = await installItem(grillMe, opencode, cwd, null);

      assert.equal(result.status, "failed");
      if (result.status === "failed") {
        assert.match(result.reason, /ENOSPC/);
        assert.match(result.reason, /no space left/);
      }
    } finally {
      _setFsOpsForTesting({});
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installAll: with no items, returns an empty array and never calls the prompt", async () => {
  const cwd = mkCwd();
  let promptCalls = 0;
  const fakePrompt = async (): Promise<"yes" | null> => {
    promptCalls += 1;
    return "yes";
  };
  try {
    const results = await installAll([], opencode, cwd, fakePrompt);
    assert.deepEqual(results, []);
    assert.equal(promptCalls, 0, "prompt should not be called for an empty item list");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("installAll: when no targets exist on disk, installs every item and never calls the prompt", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-installall-new-"));
  let promptCalls = 0;
  const fakePrompt = async (): Promise<"yes" | null> => {
    promptCalls += 1;
    return "yes";
  };
  try {
    const cmdSource = join(sourceDir, "grill-me.md");
    const agentSource = join(sourceDir, "document-writer.md");
    writeFileSync(cmdSource, "cmd content\n");
    writeFileSync(agentSource, "agent content\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: cmdSource,
    });
    const doc = makeItem({
      id: "agents/document-writer",
      type: "agent",
      name: "document-writer",
      path: agentSource,
    });

    const results = await installAll([grillMe, doc], opencode, cwd, fakePrompt);

    assert.equal(results.length, 2);
    assert.deepEqual(results[0], { status: "installed" });
    assert.deepEqual(results[1], { status: "installed" });
    assert.equal(promptCalls, 0, "prompt should never be called when no targets exist on disk");
    assert.equal(
      readFileSync(join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md"), "utf8"),
      "cmd content\n",
    );
    assert.equal(
      readFileSync(join(cwd, ".opencode", OpenCodeFolders.agents, "document-writer.md"), "utf8"),
      "agent content\n",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installAll: when a target exists, calls the prompt once and overwrites when the user picks 'yes'", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-installall-yes-"));
  try {
    const target = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.commands), { recursive: true });
    writeFileSync(target, "old content\n");
    const sourceFile = join(sourceDir, "grill-me.md");
    writeFileSync(sourceFile, "new content\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceFile,
    });

    let promptCalls = 0;
    let promptItem: Item | undefined;
    let promptPath: string | undefined;
    const fakePrompt = async (item: Item, existingPath: string): Promise<"yes" | null> => {
      promptCalls += 1;
      promptItem = item;
      promptPath = existingPath;
      return "yes";
    };

    const results = await installAll([grillMe], opencode, cwd, fakePrompt);

    assert.equal(promptCalls, 1, "prompt should be called once for the collision");
    assert.equal(promptItem?.id, "commands/grill-me");
    assert.equal(promptPath, target);
    assert.deepEqual(results[0], { status: "installed" });
    assert.equal(readFileSync(target, "utf8"), "new content\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installAll: after the user picks 'yes-all', no further prompts are called and remaining items are installed", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-installall-yes-all-"));
  try {
    const targetA = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
    const targetB = join(cwd, ".opencode", OpenCodeFolders.agents, "document-writer.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.commands), { recursive: true });
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.agents), { recursive: true });
    writeFileSync(targetA, "old A\n");
    writeFileSync(targetB, "old B\n");
    const sourceA = join(sourceDir, "grill-me.md");
    const sourceB = join(sourceDir, "document-writer.md");
    writeFileSync(sourceA, "new A\n");
    writeFileSync(sourceB, "new B\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceA,
    });
    const doc = makeItem({
      id: "agents/document-writer",
      type: "agent",
      name: "document-writer",
      path: sourceB,
    });

    let promptCalls = 0;
    const fakePrompt = async (): Promise<"yes-all" | null> => {
      promptCalls += 1;
      return "yes-all";
    };

    const results = await installAll([grillMe, doc], opencode, cwd, fakePrompt);

    assert.equal(promptCalls, 1, "prompt should be called only once even with two collisions");
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], { status: "installed" });
    assert.deepEqual(results[1], { status: "installed" });
    assert.equal(readFileSync(targetA, "utf8"), "new A\n");
    assert.equal(readFileSync(targetB, "utf8"), "new B\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installAll: after the user picks 'no-all', all remaining items are skipped and no further prompts are called", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-installall-no-all-"));
  try {
    const targetA = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
    const targetB = join(cwd, ".opencode", OpenCodeFolders.agents, "document-writer.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.commands), { recursive: true });
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.agents), { recursive: true });
    writeFileSync(targetA, "old A\n");
    writeFileSync(targetB, "old B\n");
    const sourceA = join(sourceDir, "grill-me.md");
    const sourceB = join(sourceDir, "document-writer.md");
    writeFileSync(sourceA, "new A\n");
    writeFileSync(sourceB, "new B\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceA,
    });
    const doc = makeItem({
      id: "agents/document-writer",
      type: "agent",
      name: "document-writer",
      path: sourceB,
    });

    let promptCalls = 0;
    const fakePrompt = async (): Promise<"no-all" | null> => {
      promptCalls += 1;
      return "no-all";
    };

    const results = await installAll([grillMe, doc], opencode, cwd, fakePrompt);

    assert.equal(promptCalls, 1, "prompt should be called only once even with two collisions");
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], { status: "skipped", reason: "collision-declined" });
    assert.deepEqual(results[1], { status: "skipped", reason: "collision-declined" });
    assert.equal(readFileSync(targetA, "utf8"), "old A\n", "first target should be left untouched");
    assert.equal(
      readFileSync(targetB, "utf8"),
      "old B\n",
      "second target should be left untouched",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installAll: 'no' on a single collision skips that item only and still prompts for subsequent collisions", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-installall-no-"));
  try {
    const targetA = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
    const targetB = join(cwd, ".opencode", OpenCodeFolders.agents, "document-writer.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.commands), { recursive: true });
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.agents), { recursive: true });
    writeFileSync(targetA, "old A\n");
    writeFileSync(targetB, "old B\n");
    const sourceA = join(sourceDir, "grill-me.md");
    const sourceB = join(sourceDir, "document-writer.md");
    writeFileSync(sourceA, "new A\n");
    writeFileSync(sourceB, "new B\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceA,
    });
    const doc = makeItem({
      id: "agents/document-writer",
      type: "agent",
      name: "document-writer",
      path: sourceB,
    });

    const responses: Array<"no" | "yes"> = ["no", "yes"];
    let promptCalls = 0;
    const fakePrompt = async (): Promise<"no" | "yes" | null> => {
      const next = responses[promptCalls];
      promptCalls += 1;
      return next ?? null;
    };

    const results = await installAll([grillMe, doc], opencode, cwd, fakePrompt);

    assert.equal(promptCalls, 2, "prompt should fire for each collision (no bulk choice)");
    assert.deepEqual(results[0], { status: "skipped", reason: "collision-declined" });
    assert.deepEqual(results[1], { status: "installed" });
    assert.equal(readFileSync(targetA, "utf8"), "old A\n");
    assert.equal(readFileSync(targetB, "utf8"), "new B\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installAll: when the prompt returns null, throws 'User cancelled' and the loop is aborted", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-installall-cancel-"));
  try {
    const target = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.commands), { recursive: true });
    writeFileSync(target, "old\n");
    const sourceFile = join(sourceDir, "grill-me.md");
    writeFileSync(sourceFile, "new\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: sourceFile,
    });
    const fakePrompt = async (): Promise<null> => null;
    await assert.rejects(() => installAll([grillMe], opencode, cwd, fakePrompt), /User cancelled/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installAll: items in state 'identical' short-circuit to 'already-installed', never call the prompt, and never write to the target", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-installall-identical-"));
  try {
    const cmdSource = join(sourceDir, "grill-me.md");
    const agentSource = join(sourceDir, "document-writer.md");
    writeFileSync(cmdSource, "grill-me content\n");
    writeFileSync(agentSource, "document-writer content\n");
    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: cmdSource,
    });
    const doc = makeItem({
      id: "agents/document-writer",
      type: "agent",
      name: "document-writer",
      path: agentSource,
    });

    let promptCalls = 0;
    const fakePrompt = async (): Promise<"yes" | null> => {
      promptCalls += 1;
      return "yes";
    };

    const results = await installAll([grillMe, doc], opencode, cwd, fakePrompt, () => "identical");

    assert.equal(promptCalls, 0, "prompt must not be called for items in state 'identical'");
    assert.deepEqual(results, [
      { status: "skipped", reason: "already-installed" },
      { status: "skipped", reason: "already-installed" },
    ]);
    assert.equal(
      existsSync(join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md")),
      false,
      "no file should have been written for an identical command",
    );
    assert.equal(
      existsSync(join(cwd, ".opencode", OpenCodeFolders.agents, "document-writer.md")),
      false,
      "no file should have been written for an identical agent",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("installAll: identical short-circuit does not latch bulkChoice from a previous 'yes-all' or 'no-all' answer", async () => {
  const cwd = mkCwd();
  const sourceDir = mkdtempSync(join(tmpdir(), "setup-devai-installall-idem-bulk-"));
  try {
    const cmdSource = join(sourceDir, "grill-me.md");
    const agentSource = join(sourceDir, "document-writer.md");
    const skillSource = join(sourceDir, "commit");
    mkdirSync(skillSource, { recursive: true });
    writeFileSync(cmdSource, "cmd\n");
    writeFileSync(agentSource, "agent\n");
    writeFileSync(join(skillSource, "SKILL.md"), "skill\n");

    const existingTarget = join(cwd, ".opencode", OpenCodeFolders.commands, "grill-me.md");
    mkdirSync(join(cwd, ".opencode", OpenCodeFolders.commands), { recursive: true });
    writeFileSync(existingTarget, "old\n");

    const grillMe = makeItem({
      id: "commands/grill-me",
      type: "command",
      name: "grill-me",
      path: cmdSource,
    });
    const doc = makeItem({
      id: "agents/document-writer",
      type: "agent",
      name: "document-writer",
      path: agentSource,
    });
    const commit = makeItem({
      id: "skills/commit",
      type: "skill",
      name: "commit",
      path: skillSource,
      isDirectory: true,
    });

    const states = new Map<string, "not-installed" | "identical" | "differs">([
      ["commands/grill-me", "differs"],
      ["agents/document-writer", "identical"],
      ["skills/commit", "not-installed"],
    ]);
    const getState = (item: Item): "not-installed" | "identical" | "differs" =>
      states.get(item.id) ?? "not-installed";

    let promptCalls = 0;
    const fakePrompt = async (): Promise<"yes-all" | null> => {
      promptCalls += 1;
      return "yes-all";
    };

    const results = await installAll([grillMe, doc, commit], opencode, cwd, fakePrompt, getState);

    assert.equal(promptCalls, 1, "prompt should fire only for the one 'differs' item");
    assert.deepEqual(results[0], { status: "installed" });
    assert.deepEqual(results[1], { status: "skipped", reason: "already-installed" });
    assert.deepEqual(results[2], { status: "installed" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});
