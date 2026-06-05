import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCleanup } from "../../src/core/cleanup.ts";

test("cleanupSync: first call removes the temp dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-devai-test-"));
  assert.equal(existsSync(dir), true);
  const cleanup = makeCleanup();
  cleanup(dir);
  assert.equal(existsSync(dir), false);
});

test("cleanupSync: second call on the same closure is a no-op", () => {
  const firstDir = mkdtempSync(join(tmpdir(), "setup-devai-test-"));
  const secondDir = mkdtempSync(join(tmpdir(), "setup-devai-test-"));
  try {
    const cleanup = makeCleanup();
    cleanup(firstDir);
    assert.equal(existsSync(firstDir), false);
    cleanup(secondDir);
    assert.equal(
      existsSync(secondDir),
      true,
      "second call should be a no-op, leaving secondDir intact",
    );
  } finally {
    rmSync(secondDir, { recursive: true, force: true });
  }
});

test("cleanupSync: emits a stderr warning and does not throw when rmSync fails", () => {
  const originalWrite = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    captured.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  try {
    const cleanup = makeCleanup();
    assert.doesNotThrow(() => {
      cleanup("\0invalid-path-with-null-byte");
    });
    const joined = captured.join("");
    assert.ok(
      joined.includes("Warning: failed to clean up"),
      `expected warning in stderr, got: ${JSON.stringify(joined)}`,
    );
    assert.ok(
      joined.includes("\0invalid-path-with-null-byte"),
      `expected path in warning, got: ${JSON.stringify(joined)}`,
    );
  } finally {
    process.stderr.write = originalWrite;
  }
});
