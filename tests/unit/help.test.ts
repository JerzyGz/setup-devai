import { test } from "node:test";
import { strict as assert } from "node:assert";
import { HELP_TEXT } from "../../src/core/help.ts";

const LOCKED_HELP_TEXT = `setup-devai — Bootstrap OpenCode commands, skills, and agents from a Git registry.

Usage:
  npx setup-devai

The CLI will prompt for a registry URL, walk you through the available
commands/agents/skills, and copy the selected ones to .opencode/ in
the current directory.

Flags:
  -h, --help     Print this help and exit
  -V, --version  Print the package version and exit

Requirements:
  Node.js >= 22, git in PATH

Registry contract:
  commands/<name>.md, agents/<name>.md, skills/<name>/SKILL.md
  (frontmatter: name, description, optional requires: [type/name, ...])`;

test("HELP_TEXT: matches the locked help block exactly", () => {
  assert.equal(HELP_TEXT, LOCKED_HELP_TEXT);
});

test("HELP_TEXT: uses the em-dash (—) in the header, not a hyphen", () => {
  assert.match(HELP_TEXT, /setup-devai — Bootstrap/);
});
