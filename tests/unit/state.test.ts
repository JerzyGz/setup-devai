import { test } from "node:test";
import { strict as assert } from "node:assert";
import { hasCredentials } from "../../src/core/state.ts";

test("hasCredentials: returns false for a plain https URL with no userinfo", () => {
  assert.equal(hasCredentials("https://github.com/foo/bar"), false);
});

test("hasCredentials: returns true for an https URL with a username token", () => {
  assert.equal(hasCredentials("https://token@github.com/foo/bar"), true);
});

test("hasCredentials: returns true for an https URL with user:pass userinfo", () => {
  assert.equal(hasCredentials("https://user:pass@github.com/foo/bar"), true);
});

test("hasCredentials: returns false for an SCP-style git transport URL", () => {
  assert.equal(hasCredentials("git@github.com:org/repo.git"), false);
});

test("hasCredentials: returns false for an ssh:// URL (transport user, not a credential)", () => {
  assert.equal(hasCredentials("ssh://git@github.com/org/repo.git"), false);
});

test("hasCredentials: returns false for malformed input that is not a URL", () => {
  assert.equal(hasCredentials("not a url"), false);
});

test("hasCredentials: returns false for a file:// URL", () => {
  assert.equal(hasCredentials("file:///tmp/x"), false);
});

test("hasCredentials: returns false for a plain http:// URL with no userinfo", () => {
  assert.equal(hasCredentials("http://example.com/repo.git"), false);
});

import { stateDir, stateFile } from "../../src/core/state.ts";

test("stateDir: honors XDG_DATA_HOME when set, returning <XDG_DATA_HOME>/setup-devai", () => {
  const env = { XDG_DATA_HOME: "/custom/data" };
  assert.equal(stateDir("/home/me", env), "/custom/data/setup-devai");
});

test("stateDir: falls back to <homeDir>/.local/share/setup-devai when XDG_DATA_HOME is unset", () => {
  const env = {};
  assert.equal(stateDir("/home/me", env), "/home/me/.local/share/setup-devai");
});

test("stateFile: appends state.json to the state dir", () => {
  const env = { XDG_DATA_HOME: "/custom/data" };
  assert.equal(stateFile("/home/me", env), "/custom/data/setup-devai/state.json");
});

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLastUrl, saveLastUrl, _setFsOpsForTesting } from "../../src/core/state.ts";

test("saveLastUrl: writes { lastUrl: '...' } to <stateDir>/state.json and readLastUrl returns it", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-"));
  try {
    const result = saveLastUrl(home, {}, "https://github.com/foo/bar.git");
    assert.deepEqual(result, { saved: true });

    const file = join(home, ".local", "share", "setup-devai", "state.json");
    assert.equal(
      readFileSync(file, "utf8"),
      JSON.stringify({ lastUrl: "https://github.com/foo/bar.git" }, null, 2) + "\n",
    );
    assert.equal(readLastUrl(home, {}), "https://github.com/foo/bar.git");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("saveLastUrl: writes the file with mode 0600 so it is owner-readable only", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-"));
  try {
    saveLastUrl(home, {}, "https://github.com/foo/bar.git");
    const file = join(home, ".local", "share", "setup-devai", "state.json");
    const mode = statSync(file).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("saveLastUrl: persists to a sibling temp file and renames it (atomic write), not writeFileSync to the final path", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-atomic-"));
  const renameCalls: Array<{ src: string; dest: string }> = [];
  _setFsOpsForTesting({
    renameSync: ((src: string, dest: string): void => {
      renameCalls.push({ src, dest });
    }) as never,
  });
  try {
    saveLastUrl(home, {}, "https://github.com/foo/bar.git");
    assert.equal(renameCalls.length, 1, "renameSync should be called exactly once");
    const [trace] = renameCalls;
    assert.ok(trace, "rename trace should be captured");
    assert.match(trace.src, /\.tmp$/, `rename source should be a .tmp file, got: ${trace.src}`);
    assert.equal(trace.dest, join(home, ".local", "share", "setup-devai", "state.json"));
    assert.match(trace.src, new RegExp(`^${trace.dest}\\.tmp$`));
  } finally {
    _setFsOpsForTesting({});
    rmSync(home, { recursive: true, force: true });
  }
});

test("saveLastUrl: when the URL has credentials, does NOT create the state file and returns 'credentials' as the skip reason", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-credskip-"));
  const result = saveLastUrl(home, {}, "https://token@github.com/foo/bar.git");
  assert.deepEqual(result, { saved: false, skippedReason: "credentials" });
  const stateFile = join(home, ".local", "share", "setup-devai", "state.json");
  assert.equal(
    existsSync(stateFile),
    false,
    "no state file should be created when the URL carries credentials",
  );
  const dirExists = existsSync(join(home, ".local", "share", "setup-devai"));
  assert.equal(dirExists, false, "no state directory should be created on credentials skip");
  rmSync(home, { recursive: true, force: true });
});

test("saveLastUrl: when the URL has credentials, emits the documented stderr warning", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-credskip-warn-"));
  const original = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    captured.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  try {
    saveLastUrl(home, {}, "https://user:pass@github.com/foo/bar.git");
  } finally {
    process.stderr.write = original;
    rmSync(home, { recursive: true, force: true });
  }
  const joined = captured.join("");
  assert.match(joined, /Credentials detected in URL/);
  assert.match(joined, /not saved/);
  assert.match(joined, /Configure git credentials/);
});

test("readLastUrl: returns null when the state file does not exist", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-readexists-"));
  try {
    assert.equal(readLastUrl(home, {}), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readLastUrl: returns null when the state file is malformed JSON", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-readmalformed-"));
  try {
    const file = join(home, ".local", "share", "setup-devai", "state.json");
    mkdirSync(join(home, ".local", "share", "setup-devai"), { recursive: true });
    writeFileSync(file, "this is not { json");
    assert.equal(readLastUrl(home, {}), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readLastUrl: returns null when the root is a JSON array, not an object", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-readarray-"));
  try {
    const file = join(home, ".local", "share", "setup-devai", "state.json");
    mkdirSync(join(home, ".local", "share", "setup-devai"), { recursive: true });
    writeFileSync(file, "[]");
    assert.equal(readLastUrl(home, {}), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readLastUrl: returns null when the lastUrl field is missing", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-readnokey-"));
  try {
    const file = join(home, ".local", "share", "setup-devai", "state.json");
    mkdirSync(join(home, ".local", "share", "setup-devai"), { recursive: true });
    writeFileSync(file, JSON.stringify({ something: "else" }));
    assert.equal(readLastUrl(home, {}), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readLastUrl: returns null when the lastUrl field is not a string", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-readnonstring-"));
  try {
    const file = join(home, ".local", "share", "setup-devai", "state.json");
    mkdirSync(join(home, ".local", "share", "setup-devai"), { recursive: true });
    writeFileSync(file, JSON.stringify({ lastUrl: 42 }));
    assert.equal(readLastUrl(home, {}), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readLastUrl: returns null and never throws when readFileSync fails with EACCES", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-readeacces-"));
  _setFsOpsForTesting({
    readFileSync: ((): never => {
      const err = new Error("permission denied") as Error & { code: string };
      err.code = "EACCES";
      throw err;
    }) as never,
  });
  try {
    assert.equal(readLastUrl(home, {}), null);
  } finally {
    _setFsOpsForTesting({});
    rmSync(home, { recursive: true, force: true });
  }
});

test("saveLastUrl: when writeFileSync fails with EACCES, returns 'write-error' and does NOT throw", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-writeeacces-"));
  _setFsOpsForTesting({
    writeFileSync: ((): never => {
      const err = new Error("permission denied") as Error & { code: string };
      err.code = "EACCES";
      throw err;
    }) as never,
  });
  try {
    const result = saveLastUrl(home, {}, "https://github.com/foo/bar.git");
    assert.deepEqual(result, { saved: false, skippedReason: "write-error" });
  } finally {
    _setFsOpsForTesting({});
    rmSync(home, { recursive: true, force: true });
  }
});

test("saveLastUrl: when renameSync fails with ENOSPC, returns 'write-error' and does NOT throw", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-writeenospc-"));
  _setFsOpsForTesting({
    renameSync: ((): never => {
      const err = new Error("no space left on device") as Error & { code: string };
      err.code = "ENOSPC";
      throw err;
    }) as never,
  });
  try {
    const result = saveLastUrl(home, {}, "https://github.com/foo/bar.git");
    assert.deepEqual(result, { saved: false, skippedReason: "write-error" });
  } finally {
    _setFsOpsForTesting({});
    rmSync(home, { recursive: true, force: true });
  }
});
