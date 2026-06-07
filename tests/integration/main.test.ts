import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface SpawnHandle {
  child: ChildProcess;
  result: Promise<ChildResult>;
  waitForTempDir: (timeoutMs?: number) => Promise<string>;
}

function spawnMain(
  env: Record<string, string>,
  childArgs: string[] = ["src/index.ts"],
): SpawnHandle {
  const child = spawn(process.execPath, ["--import", "tsx/esm", ...childArgs], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });

  const result: Promise<ChildResult> = exited.then(({ code, signal }) => ({
    code,
    signal,
    stdout,
    stderr,
  }));

  const waitForTempDir = (timeoutMs = 5000): Promise<string> =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const check = (): void => {
        const match = stdout.match(/setup-devai-tempdir: (.+)/);
        if (match && match[1]) {
          resolve(match[1].trim());
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(
            new Error(
              `Timed out waiting for tempdir line in stdout. Got: ${JSON.stringify(stdout)}`,
            ),
          );
          return;
        }
        setTimeout(check, 10);
      };
      check();
    });

  return { child, result, waitForTempDir };
}

/**
 * Poll until `path` no longer exists, or `timeoutMs` elapses.
 *
 * Why this exists: the child runs `rmSync` (synchronous) in its
 * signal/error/exit handlers and then calls `process.exit()`. The
 * parent awaits `child.on("exit")` and would then call `existsSync`
 * once. On loaded or cold CI runners the kernel/FS can briefly report
 * the path as still present to the parent's `existsSync` (page cache,
 * journaling, I/O contention from concurrently-spawned children), which
 * made the post-exit cleanup assertions flaky. Polling bridges that
 * visibility window.
 */
async function waitForRemoval(path: string, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (existsSync(path)) {
    if (Date.now() - start > timeoutMs) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

test("main: allocates a temp dir under os.tmpdir() matching setup-devai-* and removes it on normal completion", async () => {
  const { result, waitForTempDir } = spawnMain({
    SETUP_DEVAI_TEST_HOLD_MS: "300",
    SETUP_DEVAI_TEST_LOG_TEMPDIR: "1",
  });

  const tempDir = await waitForTempDir();
  assert.match(
    tempDir,
    /setup-devai-.+/,
    `expected tempDir to match setup-devai-*, got: ${tempDir}`,
  );
  assert.ok(
    tempDir.startsWith(tmpdir()),
    `expected tempDir to be under os.tmpdir() (${tmpdir()}), got: ${tempDir}`,
  );
  assert.equal(existsSync(tempDir), true, "temp dir should exist while main() is in its hold");

  const { code, signal } = await result;
  assert.equal(code, 0);
  assert.equal(signal, null);

  assert.equal(
    await waitForRemoval(tempDir),
    true,
    "temp dir should be removed after normal main() completion",
  );
});

test("main: prints the exact error to stderr and exits with code 1 when git is not in PATH", async () => {
  const emptyPathDir = mkdtempSync(join(tmpdir(), "setup-devai-empty-path-"));
  try {
    const { result } = spawnMain({ PATH: emptyPathDir });
    const { code, stderr, stdout } = await result;
    assert.equal(code, 1);
    assert.ok(
      stderr.includes("Error: git is not installed or not in PATH."),
      `expected exact error line in stderr, got: ${JSON.stringify(stderr)}`,
    );
    assert.equal(stdout, "", "no stdout output expected when git check fails before setup");
  } finally {
    rmSync(emptyPathDir, { recursive: true, force: true });
  }
});

test("main: handles SIGINT by cleaning up the temp dir and exiting with code 130", async () => {
  const { child, result, waitForTempDir } = spawnMain({
    SETUP_DEVAI_TEST_HOLD_MS: "10000",
    SETUP_DEVAI_TEST_LOG_TEMPDIR: "1",
  });
  const tempDir = await waitForTempDir();
  assert.equal(existsSync(tempDir), true);

  child.kill("SIGINT");
  const { code, signal } = await result;
  const terminatedBySigint =
    (code === 130 && signal === null) || (code === null && signal === "SIGINT");
  assert.ok(
    terminatedBySigint,
    `expected exit code 130 or SIGINT signal, got code=${code} signal=${signal}`,
  );
  assert.equal(await waitForRemoval(tempDir), true, "temp dir should be removed after SIGINT");
});

test("main: handles SIGTERM by cleaning up the temp dir and exiting with code 143", async () => {
  const { child, result, waitForTempDir } = spawnMain({
    SETUP_DEVAI_TEST_HOLD_MS: "10000",
    SETUP_DEVAI_TEST_LOG_TEMPDIR: "1",
  });
  const tempDir = await waitForTempDir();
  assert.equal(existsSync(tempDir), true);

  child.kill("SIGTERM");
  const { code, signal } = await result;
  const terminatedBySigterm =
    (code === 143 && signal === null) || (code === null && signal === "SIGTERM");
  assert.ok(
    terminatedBySigterm,
    `expected exit code 143 or SIGTERM signal, got code=${code} signal=${signal}`,
  );
  assert.equal(await waitForRemoval(tempDir), true, "temp dir should be removed after SIGTERM");
});

test("main: handles an uncaught exception by cleaning up, printing the error, and exiting with code 1", async () => {
  const childScript = `import { main } from "./src/index.ts";
setTimeout(() => { throw new Error("boom-uncaught"); }, 3000);
await main();`;
  const { result, waitForTempDir } = spawnMain(
    {
      SETUP_DEVAI_TEST_HOLD_MS: "30000",
      SETUP_DEVAI_TEST_LOG_TEMPDIR: "1",
    },
    ["-e", childScript],
  );
  const tempDir = await waitForTempDir();
  assert.equal(existsSync(tempDir), true);

  const { code, stderr } = await result;
  assert.equal(code, 1, `expected exit code 1, got code=${code}`);
  assert.equal(
    await waitForRemoval(tempDir),
    true,
    "temp dir should be removed after uncaught exception",
  );
  assert.ok(
    stderr.includes("boom-uncaught"),
    `expected error message in stderr, got: ${JSON.stringify(stderr)}`,
  );
});

test("main: handles an unhandled promise rejection by cleaning up, printing the error, and exiting with code 1", async () => {
  const childScript = `import { main } from "./src/index.ts";
setTimeout(() => { Promise.reject(new Error("boom-unhandled")); }, 3000);
await main();`;
  const { result, waitForTempDir } = spawnMain(
    {
      SETUP_DEVAI_TEST_HOLD_MS: "30000",
      SETUP_DEVAI_TEST_LOG_TEMPDIR: "1",
    },
    ["-e", childScript],
  );
  const tempDir = await waitForTempDir();
  assert.equal(existsSync(tempDir), true);

  const { code, stderr } = await result;
  assert.equal(code, 1, `expected exit code 1, got code=${code}`);
  assert.equal(
    await waitForRemoval(tempDir),
    true,
    "temp dir should be removed after unhandled rejection",
  );
  assert.ok(
    stderr.includes("boom-unhandled"),
    `expected error message in stderr, got: ${JSON.stringify(stderr)}`,
  );
});

test("main: cleans up the temp dir even when process.exit(1) is called from within main() (via the exit handler)", async () => {
  const childScript = `import { main } from "./src/index.ts";
setTimeout(() => { process.exit(1); }, 3000);
await main();`;
  const { result, waitForTempDir } = spawnMain(
    {
      SETUP_DEVAI_TEST_HOLD_MS: "30000",
      SETUP_DEVAI_TEST_LOG_TEMPDIR: "1",
    },
    ["-e", childScript],
  );
  const tempDir = await waitForTempDir();
  assert.equal(existsSync(tempDir), true);

  const { code } = await result;
  assert.equal(code, 1, `expected exit code 1, got code=${code}`);
  assert.equal(
    await waitForRemoval(tempDir),
    true,
    "temp dir should be removed after process.exit(1) from within main()",
  );
});
