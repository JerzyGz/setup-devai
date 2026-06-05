import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { opencode } from "../../src/agents/opencode.ts";
import { scan } from "../../src/core/registry.ts";

const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/registry");

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

test("scan: against the bundled fixture registry, returns the four valid items and warns about the orphan skill", () => {
  const captured = captureStderr();
  let items;
  try {
    items = scan(FIXTURE_DIR, opencode);
  } finally {
    captured.restore();
  }

  const ids = items.map((item) => item.id).sort();
  assert.deepEqual(ids, [
    "agents/document-writer",
    "commands/grill-me",
    "commands/minimal",
    "skills/commit",
  ]);

  const skill = items.find((item) => item.id === "skills/commit");
  assert.ok(skill);
  assert.equal(skill.isDirectory, true);
  assert.equal(skill.path, join(FIXTURE_DIR, "skills", "commit"));

  const stderr = captured.output();
  assert.ok(
    stderr.includes("orphan-skill") && /SKILL\.md/.test(stderr),
    `expected stderr to warn about orphan-skill, got: ${JSON.stringify(stderr)}`,
  );
  assert.ok(
    stderr.includes(join(FIXTURE_DIR, "commands", "minimal.md")) && /description/i.test(stderr),
    `expected stderr to warn about minimal missing description, got: ${JSON.stringify(stderr)}`,
  );
});
