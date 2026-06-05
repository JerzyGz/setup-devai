import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/index.ts";
import { HELP_TEXT } from "../../src/core/help.ts";

const pkg = createRequire(import.meta.url)("../../package.json") as { version: string };
const PACKAGE_VERSION = pkg.version;
const DIST_INDEX = join(import.meta.dirname, "../../dist/index.js");

let builtOnce = false;
function ensureBuilt(): void {
  if (builtOnce) return;
  const result = spawnSync("pnpm", ["run", "build"], {
    cwd: join(import.meta.dirname, "../.."),
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`pnpm run build failed with status ${result.status}`);
  }
  if (!existsSync(DIST_INDEX)) {
    throw new Error(`expected ${DIST_INDEX} to exist after build`);
  }
  builtOnce = true;
}

interface StubFlags {
  urlCalled: boolean;
  typeMenuCalled: boolean;
}

function makeStubPrompts(flags: StubFlags): {
  url: () => Promise<string>;
  typeMenu: () => Promise<"install">;
  itemMultiSelect: () => Promise<never[]>;
  preInstallSummary: () => Promise<void>;
  collisionPrompt: () => Promise<"yes-all">;
  postInstallSummary: () => void;
} {
  return {
    url: async () => {
      flags.urlCalled = true;
      return "https://example.invalid/never-cloned";
    },
    typeMenu: async () => {
      flags.typeMenuCalled = true;
      return "install" as const;
    },
    itemMultiSelect: async () => [],
    preInstallSummary: async () => {},
    collisionPrompt: async () => "yes-all" as const,
    postInstallSummary: () => {},
  };
}

function captureStdout(): { restore: () => void; output: () => string } {
  const original = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  return {
    restore: () => {
      process.stdout.write = original;
    },
    output: () => chunks.join(""),
  };
}

test("main: --help prints HELP_TEXT to stdout, returns without invoking url()", async () => {
  const flags: StubFlags = { urlCalled: false, typeMenuCalled: false };
  const cap = captureStdout();
  try {
    await main({ prompts: makeStubPrompts(flags) }, ["--help"]);
  } finally {
    cap.restore();
  }
  assert.equal(flags.urlCalled, false, "url() must not be called when --help is passed");
  assert.equal(flags.typeMenuCalled, false, "typeMenu() must not be called when --help is passed");
  assert.equal(cap.output(), `${HELP_TEXT}\n`);
});

test("main: -h (short) prints HELP_TEXT to stdout, returns without invoking url()", async () => {
  const flags: StubFlags = { urlCalled: false, typeMenuCalled: false };
  const cap = captureStdout();
  try {
    await main({ prompts: makeStubPrompts(flags) }, ["-h"]);
  } finally {
    cap.restore();
  }
  assert.equal(flags.urlCalled, false, "url() must not be called when -h is passed");
  assert.equal(cap.output(), `${HELP_TEXT}\n`);
});

test("main: --version prints the package.json version to stdout, does not invoke url()", async () => {
  const flags: StubFlags = { urlCalled: false, typeMenuCalled: false };
  const cap = captureStdout();
  try {
    await main({ prompts: makeStubPrompts(flags) }, ["--version"]);
  } finally {
    cap.restore();
  }
  assert.equal(flags.urlCalled, false, "url() must not be called when --version is passed");
  assert.equal(cap.output(), `${PACKAGE_VERSION}\n`);
});

test("main: -V (short) prints the package.json version to stdout, does not invoke url()", async () => {
  const flags: StubFlags = { urlCalled: false, typeMenuCalled: false };
  const cap = captureStdout();
  try {
    await main({ prompts: makeStubPrompts(flags) }, ["-V"]);
  } finally {
    cap.restore();
  }
  assert.equal(flags.urlCalled, false, "url() must not be called when -V is passed");
  assert.equal(cap.output(), `${PACKAGE_VERSION}\n`);
});

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function spawnTsxIndex(flagArgs: string[], env: Record<string, string> = {}): Promise<ChildResult> {
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/index.ts", ...flagArgs], {
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
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("main: unknown flag --foo is silently ignored; the wizard proceeds and the git-missing check still fires", async () => {
  const emptyPathDir = mkdtempSync(join(tmpdir(), "setup-devai-empty-path-cli-"));
  try {
    const { code, stdout, stderr } = await spawnTsxIndex(["--foo"], { PATH: emptyPathDir });
    assert.equal(code, 1, "unknown flag should not short-circuit; git check should run and fail");
    assert.ok(
      stderr.includes("Error: git is not installed or not in PATH."),
      `expected git-missing error in stderr, got: ${JSON.stringify(stderr)}`,
    );
    assert.equal(stdout.includes(HELP_TEXT), false, "unknown flag must not trigger help output");
    assert.equal(
      stdout.includes(PACKAGE_VERSION),
      false,
      "unknown flag must not trigger version output",
    );
  } finally {
    rmSync(emptyPathDir, { recursive: true, force: true });
  }
});

function spawnBuiltIndex(
  flagArgs: string[],
  env: Record<string, string> = {},
): Promise<ChildResult> {
  const child = spawn(process.execPath, [DIST_INDEX, ...flagArgs], {
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
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("dist: node dist/index.js --help prints the locked help block to stdout and exits 0", async () => {
  ensureBuilt();
  const { code, stdout, stderr } = await spawnBuiltIndex(["--help"]);
  assert.equal(code, 0, `expected exit code 0, got ${code}; stderr: ${stderr}`);
  assert.equal(stdout, `${HELP_TEXT}\n`);
  assert.equal(
    stderr.includes("Error: git is not installed or not in PATH."),
    false,
    "git-missing check must not fire for --help",
  );
});

test("dist: node dist/index.js -h prints the locked help block to stdout and exits 0", async () => {
  ensureBuilt();
  const emptyPathDir = mkdtempSync(join(tmpdir(), "setup-devai-empty-path-h-"));
  try {
    const { code, stdout, stderr } = await spawnBuiltIndex(["-h"], { PATH: emptyPathDir });
    assert.equal(code, 0, `expected exit code 0, got ${code}; stderr: ${stderr}`);
    assert.equal(stdout, `${HELP_TEXT}\n`);
    assert.equal(
      stderr.includes("Error: git is not installed or not in PATH."),
      false,
      "git-missing check must not fire even with empty PATH",
    );
  } finally {
    rmSync(emptyPathDir, { recursive: true, force: true });
  }
});

test("dist: node dist/index.js --version prints the package.json version to stdout and exits 0", async () => {
  ensureBuilt();
  const { code, stdout, stderr } = await spawnBuiltIndex(["--version"]);
  assert.equal(code, 0, `expected exit code 0, got ${code}; stderr: ${stderr}`);
  assert.equal(stdout, `${PACKAGE_VERSION}\n`);
});

test("dist: node dist/index.js -V prints the package.json version to stdout and exits 0", async () => {
  ensureBuilt();
  const emptyPathDir = mkdtempSync(join(tmpdir(), "setup-devai-empty-path-V-"));
  try {
    const { code, stdout, stderr } = await spawnBuiltIndex(["-V"], { PATH: emptyPathDir });
    assert.equal(code, 0, `expected exit code 0, got ${code}; stderr: ${stderr}`);
    assert.equal(stdout, `${PACKAGE_VERSION}\n`);
    assert.equal(
      stderr.includes("Error: git is not installed or not in PATH."),
      false,
      "git-missing check must not fire even with empty PATH",
    );
  } finally {
    rmSync(emptyPathDir, { recursive: true, force: true });
  }
});
