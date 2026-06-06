import { test } from "node:test";
import { strict as assert } from "node:assert";
import { hasAnyAgentFolder, _setFsOpsForTesting } from "../../../src/agents/empty-check.ts";

function restoreFsOps(): void {
  _setFsOpsForTesting({});
}

test("hasAnyAgentFolder: returns true when a 'commands' folder exists at the repo root", () => {
  const dirs = new Set(["commands", "README.md"]);
  _setFsOpsForTesting({ readdirSync: ((_p: string) => Array.from(dirs)) as never });
  try {
    assert.equal(hasAnyAgentFolder("/some/repo", ["skills", "commands", "agents"]), true);
  } finally {
    restoreFsOps();
  }
});

test("hasAnyAgentFolder: returns true when a 'skills' folder exists at the repo root", () => {
  const dirs = new Set(["skills", "LICENSE"]);
  _setFsOpsForTesting({ readdirSync: ((_p: string) => Array.from(dirs)) as never });
  try {
    assert.equal(hasAnyAgentFolder("/some/repo", ["skills", "commands", "agents"]), true);
  } finally {
    restoreFsOps();
  }
});

test("hasAnyAgentFolder: returns true when an 'agents' folder exists at the repo root", () => {
  const dirs = new Set(["agents"]);
  _setFsOpsForTesting({ readdirSync: ((_p: string) => Array.from(dirs)) as never });
  try {
    assert.equal(hasAnyAgentFolder("/some/repo", ["skills", "commands", "agents"]), true);
  } finally {
    restoreFsOps();
  }
});

test("hasAnyAgentFolder: returns false when none of the agent folders exist", () => {
  const dirs = new Set(["README.md", "LICENSE", "docs"]);
  _setFsOpsForTesting({ readdirSync: ((_p: string) => Array.from(dirs)) as never });
  try {
    assert.equal(hasAnyAgentFolder("/some/repo", ["skills", "commands", "agents"]), false);
  } finally {
    restoreFsOps();
  }
});

test("hasAnyAgentFolder: returns false for an empty directory", () => {
  const dirs = new Set<string>();
  _setFsOpsForTesting({ readdirSync: ((_p: string) => Array.from(dirs)) as never });
  try {
    assert.equal(hasAnyAgentFolder("/some/repo", ["skills", "commands", "agents"]), false);
  } finally {
    restoreFsOps();
  }
});

test("hasAnyAgentFolder: matches folder names case-sensitively (case-insensitive matches do not count)", () => {
  const dirs = new Set(["Commands", "SKILLS", "Agents"]);
  _setFsOpsForTesting({ readdirSync: ((_p: string) => Array.from(dirs)) as never });
  try {
    assert.equal(hasAnyAgentFolder("/some/repo", ["skills", "commands", "agents"]), false);
  } finally {
    restoreFsOps();
  }
});

test("hasAnyAgentFolder: only looks at top-level entries (does not recurse)", () => {
  const dirs = new Set(["docs", "src", "test"]);
  _setFsOpsForTesting({ readdirSync: ((_p: string) => Array.from(dirs)) as never });
  try {
    assert.equal(hasAnyAgentFolder("/some/repo", ["skills", "commands", "agents"]), false);
  } finally {
    restoreFsOps();
  }
});

test("hasAnyAgentFolder: works with an arbitrary folder-name list (not just the opencode ones)", () => {
  const dirs = new Set(["prompts", "snippets"]);
  _setFsOpsForTesting({ readdirSync: ((_p: string) => Array.from(dirs)) as never });
  try {
    assert.equal(hasAnyAgentFolder("/some/repo", ["prompts", "snippets"]), true);
    assert.equal(hasAnyAgentFolder("/some/repo", ["hooks", "themes"]), false);
  } finally {
    restoreFsOps();
  }
});

test("hasAnyAgentFolder: returns true as soon as the first match is found (short-circuits)", () => {
  let readdirCalls = 0;
  const readdirSync = ((): string[] => {
    readdirCalls += 1;
    return ["agents", "README.md"];
  }) as never;
  _setFsOpsForTesting({ readdirSync });
  try {
    hasAnyAgentFolder("/some/repo", ["skills", "commands", "agents"]);
    assert.equal(readdirCalls, 1);
  } finally {
    restoreFsOps();
  }
});
