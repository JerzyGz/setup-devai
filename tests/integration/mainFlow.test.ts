import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installRoot = mkdtempSync(join(tmpdir(), "setup-devai-flow-cwd-"));
process.chdir(installRoot);

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

const stubState = {
  readLastUrl: () => null,
  saveLastUrl: () => {},
  validateRegistryUrl: () => {},
};

try {
  await main({ prompts: stubPrompts, state: stubState });
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installRoot = mkdtempSync(join(tmpdir(), "setup-devai-flow-cwd-"));
process.chdir(installRoot);

const stubPrompts = {
  url: async () => ${JSON.stringify(fixtureUrl)},
  typeMenu: async () => "install",
  itemMultiSelect: async () => [],
  preInstallSummary: async () => {},
  collisionPrompt: async () => "yes-all",
  postInstallSummary: () => {},
};

const stubState = {
  readLastUrl: () => null,
  saveLastUrl: () => {},
  validateRegistryUrl: () => {},
};

try {
  await main({ prompts: stubPrompts, state: stubState });
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installRoot = mkdtempSync(join(tmpdir(), "setup-devai-flow-cwd-"));
process.chdir(installRoot);

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
} finally {
  rmSync(installRoot, { recursive: true, force: true });
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

test("main flow: with mixed not-installed / identical / differs items, identical is skipped silently, differs prompts, and the summary shows the correct breakdown", async () => {
  const source = setupFixtureAsGitRepo();
  const fixtureUrl = pathToFileURL(source).href;
  const installRoot = mkdtempSync(join(tmpdir(), "setup-devai-mixed-cwd-"));
  try {
    const grillMeFixture = readFileSync(join(source, "commands/grill-me.md"), "utf8");
    const cmdDir = join(installRoot, ".opencode", "commands");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(join(cmdDir, "grill-me.md"), grillMeFixture, "utf8");
    const minimalDir = join(installRoot, ".opencode", "commands");
    writeFileSync(
      join(minimalDir, "minimal.md"),
      "---\nname: minimal\ndescription: Old minimal\n---\n# minimal\nOLD LOCAL CONTENT\n",
      "utf8",
    );
    const driver = `
import { main } from "./src/index.ts";
import * as realPrompts from "./src/core/prompts.ts";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installRoot = ${JSON.stringify(installRoot)};
process.chdir(installRoot);

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
  preInstallSummary: async (selections, collisions, targetPath, profile) => {
    realPrompts.preInstallSummary(selections, collisions, targetPath, profile);
    writeFileSync(join(installRoot, "preinstall.json"), JSON.stringify({
      selectionNames: selections.map((i) => i.name),
      collisionPaths: collisions.paths,
    }));
  },
  collisionPrompt: async (item, existingPath) => {
    appendFileSync(join(installRoot, "collision.log"), item.name + "\\n");
    return "yes-all";
  },
  postInstallSummary: (items, results, targetPath, profile) => {
    realPrompts.postInstallSummary(items, results, targetPath, profile);
  },
};

const stubState = {
  readLastUrl: () => null,
  saveLastUrl: () => {},
  validateRegistryUrl: () => {},
};

try {
  await main({ prompts: stubPrompts, state: stubState });
} catch (err) {
  process.stderr.write("DRIVER_ERROR: " + (err instanceof Error ? err.stack : String(err)) + "\\n");
  process.exit(2);
}
`;
    const { result } = spawnDriver(driver);
    const { code, signal, stdout, stderr } = await result;
    assert.equal(
      code,
      0,
      `expected exit code 0, got code=${code} signal=${signal}\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
    assert.match(
      stdout,
      /Skipped 1 \(1 already installed, 0 collisions declined\)/,
      `expected the Skipped line to break down as '1 already installed, 0 collisions declined', got: ${stdout}`,
    );
    assert.match(
      stdout,
      /Installed 3 items to /,
      `expected 3 installs (document-writer, minimal, commit), got: ${stdout}`,
    );
    const { readFileSync: readIt } = await import("node:fs");
    const preinstallRaw = readIt(join(installRoot, "preinstall.json"), "utf8");
    const preinstall = JSON.parse(preinstallRaw) as {
      selectionNames: string[];
      collisionPaths: string[];
    };
    assert.deepEqual(
      preinstall.selectionNames.sort(),
      ["commit", "document-writer", "grill-me", "minimal"],
      "all 4 items should be in the selection",
    );
    assert.equal(
      preinstall.collisionPaths.length,
      1,
      `collision report should list exactly 1 path (the 'differs' minimal), got: ${preinstall.collisionPaths.join(", ")}`,
    );
    assert.ok(
      preinstall.collisionPaths[0]?.endsWith("commands/minimal.md"),
      `the one collision should be minimal.md, got: ${preinstall.collisionPaths[0]}`,
    );
    const collisionLog = readIt(join(installRoot, "collision.log"), "utf8");
    assert.match(
      collisionLog,
      /minimal/,
      "the differs item (minimal) should have triggered a collision prompt",
    );
    assert.doesNotMatch(
      collisionLog,
      /grill-me/,
      "the identical item (grill-me) should NOT have triggered a collision prompt",
    );
    const installedMinimal = readIt(
      join(installRoot, ".opencode", "commands", "minimal.md"),
      "utf8",
    );
    assert.doesNotMatch(
      installedMinimal,
      /OLD LOCAL CONTENT/,
      "the 'differs' file should have been overwritten by the registry content",
    );
    const installedGrill = readIt(
      join(installRoot, ".opencode", "commands", "grill-me.md"),
      "utf8",
    );
    assert.equal(
      installedGrill,
      grillMeFixture,
      "the 'identical' file should be untouched (still byte-for-byte the registry content)",
    );
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(installRoot, { recursive: true, force: true });
  }
});

test("main flow: validateRegistryUrl is called between url() and cloneShallow, and a rejection aborts the wizard with exit code 1", async () => {
  const submittedUrl = "https://token@github.com/foo/bar";
  const driver = `
import { main } from "./src/index.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installRoot = mkdtempSync(join(tmpdir(), "setup-devai-validate-cwd-"));
process.chdir(installRoot);

const stubPrompts = {
  url: async () => {
    process.stdout.write("CALL:url\\n");
    return ${JSON.stringify(submittedUrl)};
  },
  typeMenu: async () => "install",
  itemMultiSelect: async () => [],
  preInstallSummary: async () => {},
  collisionPrompt: async () => "yes-all",
  postInstallSummary: () => {},
};

const stubState = {
  readLastUrl: () => null,
  saveLastUrl: () => {},
  validateRegistryUrl: (url) => {
    process.stdout.write("CALL:validate:" + url + "\\n");
    throw new Error("registry URL rejected (credentials): " + url);
  },
};

try {
  await main({ prompts: stubPrompts, state: stubState });
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
`;
  const { result } = spawnDriver(driver);
  const { code, signal, stdout, stderr } = await result;
  assert.equal(
    code,
    1,
    `expected exit code 1 from validation rejection, got code=${code} signal=${signal}\nstdout: ${stdout}\nstderr: ${stderr}`,
  );
  const urlIdx = stdout.indexOf("CALL:url");
  const validateIdx = stdout.indexOf("CALL:validate:");
  assert.ok(urlIdx >= 0, `expected 'CALL:url' marker in stdout, got: ${stdout}`);
  assert.ok(validateIdx >= 0, `expected 'CALL:validate:' marker in stdout, got: ${stdout}`);
  assert.ok(validateIdx > urlIdx, "validate must be called AFTER url");
  assert.match(
    stdout,
    new RegExp(`CALL:validate:${submittedUrl.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`),
    "validate should be called with the URL the user submitted",
  );
});

test("main flow: cloned repo with no agent folders prints the friendly message and exits 0 without prompting for type", async () => {
  const source = mkdtempSync(join(tmpdir(), "setup-devai-empty-registry-src-"));
  writeFileSync(join(source, "README.md"), "# Just a readme, no agent folders here\n");
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@test",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@test",
  };
  spawnSync("git", ["init", "-q"], { cwd: source, env, stdio: "ignore" });
  spawnSync("git", ["add", "-A"], { cwd: source, env, stdio: "ignore" });
  const commit = spawnSync("git", ["commit", "-q", "-m", "empty fixture"], {
    cwd: source,
    env,
    stdio: "ignore",
  });
  if (commit.status !== 0) {
    throw new Error(
      `git commit failed in empty-registry setup: ${commit.stderr?.toString() ?? ""}`,
    );
  }
  const fixtureUrl = pathToFileURL(source).href;
  const driver = `
import { main } from "./src/index.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installRoot = mkdtempSync(join(tmpdir(), "setup-devai-empty-flow-cwd-"));
process.chdir(installRoot);

const stubPrompts = {
  url: async () => ${JSON.stringify(fixtureUrl)},
  typeMenu: async () => {
    process.stdout.write("CALL:typeMenu\\n");
    return "install";
  },
  itemMultiSelect: async () => [],
  preInstallSummary: async () => {},
  collisionPrompt: async () => "yes-all",
  postInstallSummary: () => {},
};

const stubState = {
  readLastUrl: () => null,
  saveLastUrl: () => {
    process.stdout.write("CALL:saveLastUrl\\n");
  },
  validateRegistryUrl: () => {},
};

try {
  await main({ prompts: stubPrompts, state: stubState });
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
`;
  try {
    const { result } = spawnDriver(driver);
    const { code, signal, stdout, stderr } = await result;
    assert.equal(
      code,
      0,
      `expected exit code 0 (friendly empty-registry message), got code=${code} signal=${signal}\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
    assert.match(
      stdout,
      new RegExp(
        `the repository ${fixtureUrl.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")} doesn't have any configuration \\(skills, commands or agents\\)`,
      ),
      `expected the friendly empty-registry message in stdout, got: ${stdout}`,
    );
    assert.doesNotMatch(
      stdout,
      /CALL:typeMenu/,
      `typeMenu should NOT be called when the cloned repo is empty, got: ${stdout}`,
    );
    assert.doesNotMatch(
      stdout,
      /CALL:saveLastUrl/,
      `saveLastUrl should NOT be called when the cloned repo is empty (do not poison state with bad URL), got: ${stdout}`,
    );
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});
