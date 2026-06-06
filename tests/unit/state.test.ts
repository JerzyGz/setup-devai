import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RegistryUrlRejectedError,
  readLastUrl,
  saveLastUrl,
  stateDir,
  stateFile,
  validateRegistryUrl,
  _setFsOpsForTesting,
} from "../../src/core/state.ts";

test("RegistryUrlRejectedError: is an Error subclass carrying reason and url", () => {
  const err = new RegistryUrlRejectedError("credentials", "https://token@host/x");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof RegistryUrlRejectedError);
  assert.equal(err.reason, "credentials");
  assert.equal(err.url, "https://token@host/x");
});

test("validateRegistryUrl: returns void (no throw) for a plain https URL with no userinfo", () => {
  assert.equal(validateRegistryUrl("https://github.com/foo/bar"), undefined);
});

test("validateRegistryUrl: returns void for a plain http:// URL with no userinfo", () => {
  assert.equal(validateRegistryUrl("http://example.com/repo.git"), undefined);
});

test("validateRegistryUrl: returns void for an SCP-style git transport URL", () => {
  assert.equal(validateRegistryUrl("git@github.com:org/repo.git"), undefined);
});

test("validateRegistryUrl: returns void for an ssh:// URL (transport user, not a credential)", () => {
  assert.equal(validateRegistryUrl("ssh://git@github.com/org/repo.git"), undefined);
});

test("validateRegistryUrl: throws RegistryUrlRejectedError with reason 'credentials' for https URL with username token", () => {
  let caught: unknown;
  try {
    validateRegistryUrl("https://token@github.com/foo/bar");
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof RegistryUrlRejectedError, "expected RegistryUrlRejectedError");
  assert.equal((caught as RegistryUrlRejectedError).reason, "credentials");
  assert.equal((caught as RegistryUrlRejectedError).url, "https://token@github.com/foo/bar");
});

test("validateRegistryUrl: throws RegistryUrlRejectedError with reason 'credentials' for https URL with user:pass userinfo", () => {
  let caught: unknown;
  try {
    validateRegistryUrl("https://user:pass@github.com/foo/bar");
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof RegistryUrlRejectedError, "expected RegistryUrlRejectedError");
  assert.equal((caught as RegistryUrlRejectedError).reason, "credentials");
  assert.equal((caught as RegistryUrlRejectedError).url, "https://user:pass@github.com/foo/bar");
});

test("validateRegistryUrl: throws RegistryUrlRejectedError with reason 'file-url' for a file:// URL", () => {
  let caught: unknown;
  try {
    validateRegistryUrl("file:///tmp/x");
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof RegistryUrlRejectedError, "expected RegistryUrlRejectedError");
  assert.equal((caught as RegistryUrlRejectedError).reason, "file-url");
  assert.equal((caught as RegistryUrlRejectedError).url, "file:///tmp/x");
});

test("validateRegistryUrl: throws RegistryUrlRejectedError with reason 'malformed-url' for non-URL, non-SCP input", () => {
  let caught: unknown;
  try {
    validateRegistryUrl("not a url");
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof RegistryUrlRejectedError, "expected RegistryUrlRejectedError");
  assert.equal((caught as RegistryUrlRejectedError).reason, "malformed-url");
  assert.equal((caught as RegistryUrlRejectedError).url, "not a url");
});

test("validateRegistryUrl: on credentials rejection, writes the 3-line stderr block echoing the URL", () => {
  const original = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    captured.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  try {
    try {
      validateRegistryUrl("https://user:pass@github.com/foo/bar");
    } catch {
      // expected
    }
  } finally {
    process.stderr.write = original;
  }
  const joined = captured.join("");
  assert.match(joined, /setup-devai: registry URL rejected/);
  assert.match(joined, /reason: URL contains embedded credentials/);
  assert.match(joined, /url:    https:\/\/user:pass@github\.com\/foo\/bar/);
});

test("validateRegistryUrl: on file-url rejection, writes the file-url reason in the stderr block", () => {
  const original = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    captured.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  try {
    try {
      validateRegistryUrl("file:///tmp/x");
    } catch {
      // expected
    }
  } finally {
    process.stderr.write = original;
  }
  const joined = captured.join("");
  assert.match(joined, /setup-devai: registry URL rejected/);
  assert.match(joined, /reason: URL is a local file path, not a remote registry/);
  assert.match(joined, /url:    file:\/\/\/tmp\/x/);
});

test("validateRegistryUrl: on malformed-url rejection, writes the malformed-url reason in the stderr block", () => {
  const original = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    captured.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  try {
    try {
      validateRegistryUrl("not a url");
    } catch {
      // expected
    }
  } finally {
    process.stderr.write = original;
  }
  const joined = captured.join("");
  assert.match(joined, /setup-devai: registry URL rejected/);
  assert.match(joined, /reason: URL is malformed/);
  assert.match(joined, /url:    not a url/);
});

test("stateDir: honors XDG_DATA_HOME when set, returning <XDG_DATA_HOME>/setup-devai", () => {
  const env = { XDG_DATA_HOME: "/custom/data" };
  assert.equal(stateDir("/home/me", env), "/custom/data/setup-devai");
});

test("stateDir: falls back to <homeDir>/.local/share/setup-devai when XDG_DATA_HOME is unset", () => {
  const env = {};
  assert.equal(stateDir("/home/me", env, "linux"), "/home/me/.local/share/setup-devai");
});

test("stateDir: on linux uses ~/.local/share/setup-devai when XDG_DATA_HOME is unset", () => {
  const env = {};
  assert.equal(stateDir("/home/me", env, "linux"), "/home/me/.local/share/setup-devai");
});

test("stateDir: on darwin uses ~/Library/Application Support/setup-devai when XDG_DATA_HOME is unset", () => {
  const env = {};
  assert.equal(
    stateDir("/Users/me", env, "darwin"),
    "/Users/me/Library/Application Support/setup-devai",
  );
});

test("stateDir: on win32 uses %APPDATA%/setup-devai when XDG_DATA_HOME is unset", () => {
  const env = { APPDATA: join("C:\\Users\\me", "AppData", "Roaming") };
  const expected = join(env.APPDATA, "setup-devai");
  assert.equal(stateDir("C:\\Users\\me", env, "win32"), expected);
});

test("stateDir: on win32 falls back to homedir when APPDATA is unset", () => {
  const env = {};
  const expected = join("C:\\Users\\me", "setup-devai");
  assert.equal(stateDir("C:\\Users\\me", env, "win32"), expected);
});

test("stateDir: honors XDG_DATA_HOME on darwin", () => {
  const env = { XDG_DATA_HOME: "/custom/data" };
  assert.equal(stateDir("/Users/me", env, "darwin"), "/custom/data/setup-devai");
});

test("stateDir: honors XDG_DATA_HOME on win32", () => {
  const env = {
    XDG_DATA_HOME: join("D:\\", "xdg-data"),
    APPDATA: join("C:\\Users\\me", "AppData", "Roaming"),
  };
  const expected = join(env.XDG_DATA_HOME, "setup-devai");
  assert.equal(stateDir("C:\\Users\\me", env, "win32"), expected);
});

test("stateDir: honors XDG_DATA_HOME when set to empty string (treated as unset)", () => {
  const env = { XDG_DATA_HOME: "" };
  assert.equal(stateDir("/home/me", env, "linux"), "/home/me/.local/share/setup-devai");
  assert.equal(
    stateDir("/Users/me", env, "darwin"),
    "/Users/me/Library/Application Support/setup-devai",
  );
});

test("stateFile: appends state.json to the state dir", () => {
  const env = { XDG_DATA_HOME: "/custom/data" };
  assert.equal(stateFile("/home/me", env), "/custom/data/setup-devai/state.json");
});

test("saveLastUrl: writes { lastUrl: '...' } to <stateDir>/state.json and readLastUrl returns it", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-"));
  try {
    saveLastUrl(home, {}, "https://github.com/foo/bar.git", "linux");

    const file = join(home, ".local", "share", "setup-devai", "state.json");
    assert.equal(
      readFileSync(file, "utf8"),
      JSON.stringify({ lastUrl: "https://github.com/foo/bar.git" }, null, 2) + "\n",
    );
    assert.equal(readLastUrl(home, {}, "linux"), "https://github.com/foo/bar.git");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("saveLastUrl: writes the file with mode 0600 so it is owner-readable only", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-"));
  try {
    saveLastUrl(home, {}, "https://github.com/foo/bar.git", "linux");
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
    saveLastUrl(home, {}, "https://github.com/foo/bar.git", "linux");
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

test("saveLastUrl: does not validate the URL — a credentialed URL is written verbatim (validation is the caller's job)", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-novalidate-"));
  try {
    assert.doesNotThrow(() => {
      saveLastUrl(home, {}, "https://token@github.com/foo/bar.git", "linux");
    });
    const file = join(home, ".local", "share", "setup-devai", "state.json");
    const contents = readFileSync(file, "utf8");
    assert.match(contents, /"lastUrl":\s*"https:\/\/token@github\.com\/foo\/bar\.git"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("saveLastUrl: when writeFileSync fails with EACCES, throws RegistryUrlRejectedError with reason 'write-error' and writes the 3-line block", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-writeeacces-"));
  const fsErr = new Error("permission denied") as Error & { code: string };
  fsErr.code = "EACCES";
  _setFsOpsForTesting({
    writeFileSync: ((): never => {
      throw fsErr;
    }) as never,
  });
  const original = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    captured.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  let caught: unknown;
  try {
    try {
      saveLastUrl(home, {}, "https://github.com/foo/bar.git", "linux");
    } catch (e) {
      caught = e;
    }
  } finally {
    process.stderr.write = original;
    _setFsOpsForTesting({});
    rmSync(home, { recursive: true, force: true });
  }
  assert.ok(
    caught instanceof RegistryUrlRejectedError,
    "expected RegistryUrlRejectedError to be thrown",
  );
  assert.equal((caught as RegistryUrlRejectedError).reason, "write-error");
  assert.equal((caught as RegistryUrlRejectedError).url, "https://github.com/foo/bar.git");
  assert.equal((caught as RegistryUrlRejectedError).cause, fsErr);
  const joined = captured.join("");
  assert.match(joined, /setup-devai: registry URL rejected/);
  assert.match(joined, /reason: Could not write state file: permission denied/);
  assert.match(joined, /url:    https:\/\/github\.com\/foo\/bar\.git/);
});

test("saveLastUrl: when renameSync fails with ENOSPC, throws RegistryUrlRejectedError with reason 'write-error' and writes the 3-line block", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-writeenospc-"));
  const fsErr = new Error("no space left on device") as Error & { code: string };
  fsErr.code = "ENOSPC";
  _setFsOpsForTesting({
    renameSync: ((): never => {
      throw fsErr;
    }) as never,
  });
  const original = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    captured.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  let caught: unknown;
  try {
    try {
      saveLastUrl(home, {}, "https://github.com/foo/bar.git", "linux");
    } catch (e) {
      caught = e;
    }
  } finally {
    process.stderr.write = original;
    _setFsOpsForTesting({});
    rmSync(home, { recursive: true, force: true });
  }
  assert.ok(
    caught instanceof RegistryUrlRejectedError,
    "expected RegistryUrlRejectedError to be thrown",
  );
  assert.equal((caught as RegistryUrlRejectedError).reason, "write-error");
  assert.equal((caught as RegistryUrlRejectedError).cause, fsErr);
  const joined = captured.join("");
  assert.match(joined, /setup-devai: registry URL rejected/);
  assert.match(joined, /reason: Could not write state file: no space left on device/);
});

test("readLastUrl: returns null when the state file does not exist", () => {
  const home = mkdtempSync(join(tmpdir(), "setup-devai-state-readexists-"));
  try {
    assert.equal(readLastUrl(home, {}, "linux"), null);
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
    assert.equal(readLastUrl(home, {}, "linux"), null);
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
    assert.equal(readLastUrl(home, {}, "linux"), null);
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
    assert.equal(readLastUrl(home, {}, "linux"), null);
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
    assert.equal(readLastUrl(home, {}, "linux"), null);
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
    assert.equal(readLastUrl(home, {}, "linux"), null);
  } finally {
    _setFsOpsForTesting({});
    rmSync(home, { recursive: true, force: true });
  }
});
