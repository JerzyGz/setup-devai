import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opencode } from "../../src/agents/opencode.ts";
import { scan } from "../../src/core/registry.ts";

function mkRoot(): string {
  return mkdtempSync(join(tmpdir(), "setup-devai-registry-test-"));
}

function captureStderr(): { restore: () => void; output: () => string } {
  const original = process.stderr.write.bind(process.stderr);
  const chunks: string[] = [];
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  return {
    restore: () => {
      process.stderr.write = original;
    },
    output: () => chunks.join(""),
  };
}

test("scan: returns [] for an empty root dir", () => {
  const root = mkRoot();
  try {
    assert.deepEqual(scan(root, opencode), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan: returns one Item per .md file in the commandDir with frontmatter applied", () => {
  const root = mkRoot();
  try {
    mkdirSync(join(root, "commands"), { recursive: true });
    writeFileSync(
      join(root, "commands", "grill-me.md"),
      "---\nname: grill-me\ndescription: A test command\n---\n# body\n",
    );

    const items = scan(root, opencode);
    assert.equal(items.length, 1);
    const item = items[0]!;
    assert.equal(item.id, "commands/grill-me");
    assert.equal(item.type, "command");
    assert.equal(item.name, "grill-me");
    assert.equal(item.description, "A test command");
    assert.equal(item.path, join(root, "commands", "grill-me.md"));
    assert.equal(item.isDirectory, false);
    assert.deepEqual(item.frontmatter, {
      name: "grill-me",
      description: "A test command",
      requires: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan: returns one Item per .md file in the agentDir, typed as 'agent'", () => {
  const root = mkRoot();
  try {
    mkdirSync(join(root, "agents"), { recursive: true });
    writeFileSync(
      join(root, "agents", "document-writer.md"),
      "---\nname: document-writer\ndescription: A test agent\n---\n",
    );

    const items = scan(root, opencode);
    assert.equal(items.length, 1);
    const item = items[0]!;
    assert.equal(item.id, "agents/document-writer");
    assert.equal(item.type, "agent");
    assert.equal(item.path, join(root, "agents", "document-writer.md"));
    assert.equal(item.isDirectory, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan: returns one Item per skill dir containing SKILL.md, with isDirectory true", () => {
  const root = mkRoot();
  try {
    mkdirSync(join(root, "skills", "commit"), { recursive: true });
    writeFileSync(
      join(root, "skills", "commit", "SKILL.md"),
      "---\nname: commit\ndescription: A test skill\n---\n",
    );
    writeFileSync(join(root, "skills", "commit", "helpers.js"), "module.exports = {};\n");

    const items = scan(root, opencode);
    assert.equal(items.length, 1);
    const item = items[0]!;
    assert.equal(item.id, "skills/commit");
    assert.equal(item.type, "skill");
    assert.equal(item.name, "commit");
    assert.equal(item.description, "A test skill");
    assert.equal(item.path, join(root, "skills", "commit"));
    assert.equal(item.isDirectory, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan: skips skill dirs without SKILL.md and emits a stderr warning naming the dir", () => {
  const root = mkRoot();
  const captured = captureStderr();
  try {
    mkdirSync(join(root, "skills", "orphan-skill"), { recursive: true });
    writeFileSync(join(root, "skills", "orphan-skill", "random.txt"), "junk\n");

    const items = scan(root, opencode);
    captured.restore();

    assert.deepEqual(items, []);
    const stderr = captured.output();
    assert.ok(
      stderr.includes("orphan-skill"),
      `expected stderr to name 'orphan-skill', got: ${JSON.stringify(stderr)}`,
    );
    assert.ok(
      /SKILL\.md/.test(stderr),
      `expected stderr to mention SKILL.md, got: ${JSON.stringify(stderr)}`,
    );
    assert.ok(
      /skipping/i.test(stderr),
      `expected stderr to say 'skipping', got: ${JSON.stringify(stderr)}`,
    );
  } finally {
    captured.restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan: warns to stderr when an item has no description, and sets description to ''", () => {
  const root = mkRoot();
  const captured = captureStderr();
  try {
    mkdirSync(join(root, "commands"), { recursive: true });
    const filePath = join(root, "commands", "minimal.md");
    writeFileSync(filePath, "---\nname: minimal\n---\n");

    const items = scan(root, opencode);
    captured.restore();

    assert.equal(items.length, 1);
    const item = items[0]!;
    assert.equal(item.description, "");
    const stderr = captured.output();
    assert.ok(
      stderr.includes(filePath),
      `expected stderr to name the file path, got: ${JSON.stringify(stderr)}`,
    );
    assert.ok(
      /description/i.test(stderr),
      `expected stderr to mention 'description', got: ${JSON.stringify(stderr)}`,
    );
  } finally {
    captured.restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan: warns and still includes items with malformed frontmatter, using fallback name", () => {
  const root = mkRoot();
  const captured = captureStderr();
  try {
    mkdirSync(join(root, "commands"), { recursive: true });
    const filePath = join(root, "commands", "broken-thing.md");
    writeFileSync(
      filePath,
      "---\nname: broken-thing\ndescription: incomplete\n# missing closing\n",
    );

    const items = scan(root, opencode);
    captured.restore();

    assert.equal(items.length, 1);
    const item = items[0]!;
    assert.equal(item.id, "commands/broken-thing");
    assert.equal(item.name, "broken-thing");
    const stderr = captured.output();
    assert.ok(
      stderr.includes(filePath),
      `expected stderr to name the file path, got: ${JSON.stringify(stderr)}`,
    );
    assert.ok(
      /malformed frontmatter/.test(stderr),
      `expected stderr to mention 'malformed frontmatter', got: ${JSON.stringify(stderr)}`,
    );
  } finally {
    captured.restore();
    rmSync(root, { recursive: true, force: true });
  }
});
