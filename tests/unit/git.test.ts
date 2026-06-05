import { test } from "node:test";
import { strict as assert } from "node:assert";
import { commandExists } from "../../src/core/git.ts";

test("commandExists: returns true for a command that is in PATH", () => {
  assert.equal(commandExists("node"), true);
});

test("commandExists: returns false for a command that is not in PATH", () => {
  assert.equal(commandExists("setup-devai-this-binary-does-not-exist-xyz-12345"), false);
});
