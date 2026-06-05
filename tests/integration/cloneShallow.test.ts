import { test } from "node:test";
import { strict as assert } from "node:assert";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cloneShallow } from "../../src/core/git.ts";

const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/registry");

function setupFixtureAsGitRepo(): string {
  const source = mkdtempSync(join(tmpdir(), "setup-devai-cloneShallow-src-"));
  cpSync(FIXTURE_DIR, source, { recursive: true });
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@test",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@test",
  };
  spawnSync("git", ["init", "-q"], { cwd: source, env, stdio: "ignore" });
  spawnSync("git", ["add", "-A"], { cwd: source, env, stdio: "ignore" });
  const commit = spawnSync("git", ["commit", "-q", "-m", "fixture"], {
    cwd: source,
    env,
    stdio: "ignore",
  });
  if (commit.status !== 0) {
    throw new Error(`git commit failed in fixture setup: ${commit.stderr?.toString() ?? ""}`);
  }
  return source;
}

test("cloneShallow: clones a file:// URL into a temp dir and populates the expected files", async () => {
  const source = setupFixtureAsGitRepo();
  const dest = mkdtempSync(join(tmpdir(), "setup-devai-cloneShallow-dest-"));
  try {
    await cloneShallow(pathToFileURL(source).href, dest);

    assert.equal(existsSync(join(dest, "commands/grill-me.md")), true);
    assert.equal(existsSync(join(dest, "commands/minimal.md")), true);
    assert.equal(existsSync(join(dest, "agents/document-writer.md")), true);
    assert.equal(existsSync(join(dest, "skills/commit/SKILL.md")), true);
    assert.equal(existsSync(join(dest, "skills/commit/helpers.js")), true);
    assert.equal(existsSync(join(dest, "skills/orphan-skill/random.txt")), true);
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});

test("cloneShallow: rejects with a 'git clone failed: ...' Error when the URL does not exist", async () => {
  const dest = mkdtempSync(join(tmpdir(), "setup-devai-cloneShallow-dest-"));
  const missingPath = join(
    tmpdir(),
    `setup-devai-cloneShallow-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  try {
    await assert.rejects(
      () => cloneShallow(pathToFileURL(missingPath).href, dest),
      (err: unknown) => {
        assert.ok(err instanceof Error, `expected Error, got: ${String(err)}`);
        assert.ok(
          err.message.startsWith("git clone failed: "),
          `expected message to start with 'git clone failed: ', got: ${err.message}`,
        );
        assert.ok(
          err.message.length > "git clone failed: ".length,
          `expected message to include a failure detail beyond the prefix, got: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});
