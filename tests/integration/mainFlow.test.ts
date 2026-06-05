import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/registry");

function setupFixtureAsGitRepo(): string {
  const source = mkdtempSync(join(tmpdir(), "setup-devai-flow-src-"));
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

interface FlowChild {
  result: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>;
}

function spawnDriver(driverScript: string, env: Record<string, string> = {}): FlowChild {
  const child = spawn(process.execPath, ["--import", "tsx/esm", "-e", driverScript], {
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
  return {
    result: exited.then(({ code, signal }) => ({ code, signal, stdout, stderr })),
  };
}

const FULL_FIXTURE_DRIVER = (fixtureUrl: string, postInstallBehavior: string): string => `
import { main } from "./src/index.ts";
import * as realPrompts from "./src/core/prompts.ts";

let typeMenuCall = 0;
const order = ["command", "agent", "skill", "install"];

const stubPrompts = {
  url: async () => ${JSON.stringify(fixtureUrl)},
  typeMenu: async () => {
    const next = order[typeMenuCall] ?? "install";
    typeMenuCall++;
    return next;
  },
  itemMultiSelect: async (items, type) => {
    return items.filter((i) => i.type === type);
  },
  preInstallSummary: async () => {},
  collisionPrompt: async () => "yes-all",
  postInstallSummary: ${postInstallBehavior},
};

await main({ prompts: stubPrompts });
`;

test("main flow: full successful install of fixture registry exits 0, renders the post-install summary, and cleans up the temp dir", async () => {
  const source = setupFixtureAsGitRepo();
  const fixtureUrl = pathToFileURL(source).href;
  const passThroughPostInstall = `(items, results, targetPath, profile) => {
  realPrompts.postInstallSummary(items, results, targetPath, profile);
}`;
  try {
    const { result } = spawnDriver(FULL_FIXTURE_DRIVER(fixtureUrl, passThroughPostInstall));
    const { code, signal, stdout, stderr } = await result;
    assert.equal(
      code,
      0,
      `expected exit code 0, got code=${code} signal=${signal}\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
    assert.match(
      stdout,
      /Installed 4 items to /,
      `expected summary header in stdout, got: ${stdout}`,
    );
    assert.match(stdout, /2 Commands/, `expected '2 Commands' line in stdout, got: ${stdout}`);
    assert.match(
      stdout,
      /1 Agents \/ Subagents/,
      `expected per-type line in stdout, got: ${stdout}`,
    );
    assert.match(stdout, /1 Skills/, `expected per-type line in stdout, got: ${stdout}`);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test("main flow: user picks [ Install ] with no selections prints 'Nothing selected. Exiting.', exits 0, and does not call postInstallSummary", async () => {
  const source = setupFixtureAsGitRepo();
  const fixtureUrl = pathToFileURL(source).href;
  const driver = `
import { main } from "./src/index.ts";

const stubPrompts = {
  url: async () => ${JSON.stringify(fixtureUrl)},
  typeMenu: async () => "install",
  itemMultiSelect: async () => [],
  preInstallSummary: async () => {},
  collisionPrompt: async () => "yes-all",
  postInstallSummary: () => {},
};

await main({ prompts: stubPrompts });
`;
  try {
    const { result } = spawnDriver(driver);
    const { code, signal, stdout, stderr } = await result;
    assert.equal(
      code,
      0,
      `expected exit code 0, got code=${code} signal=${signal}\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
    assert.match(
      stdout,
      /Nothing selected\. Exiting\./,
      `expected 'Nothing selected. Exiting.' in stdout, got: ${stdout}`,
    );
    assert.doesNotMatch(
      stdout,
      /Installed \d+ items to /,
      `post-install summary should NOT be printed when nothing selected, got: ${stdout}`,
    );
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test("main flow: when url() rejects (simulated git clone failure), main()'s catch sets exitCode=1 so the process exits 1", async () => {
  const driver = `
import { main } from "./src/index.ts";

const stubPrompts = {
  url: async () => {
    throw new Error("git clone failed: simulated network failure");
  },
  typeMenu: async () => "install",
  itemMultiSelect: async () => [],
  preInstallSummary: async () => {},
  collisionPrompt: async () => "yes-all",
  postInstallSummary: () => {},
};

try {
  await main({ prompts: stubPrompts });
  process.stdout.write("MAIN_RETURNED");
} catch (e) {
  process.stdout.write("MAIN_THREW");
}
`;
  const { result } = spawnDriver(driver);
  const { code, signal, stdout, stderr } = await result;
  assert.equal(
    code,
    1,
    `expected exit code 1, got code=${code} signal=${signal}\nstdout: ${stdout}\nstderr: ${stderr}`,
  );
});
