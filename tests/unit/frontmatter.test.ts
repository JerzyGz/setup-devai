import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseFrontmatter } from "../../src/core/frontmatter.ts";

test("parseFrontmatter: returns fallback for empty input", () => {
  assert.deepEqual(parseFrontmatter(""), { name: "", description: "", requires: [] });
});

test("parseFrontmatter: parses unquoted scalar name and description", () => {
  const md = "---\nname: grill-me\ndescription: A test command\n---\n\n# body\n";
  assert.deepEqual(parseFrontmatter(md), {
    name: "grill-me",
    description: "A test command",
    requires: [],
  });
});

test("parseFrontmatter: parses inline requires array", () => {
  const md = "---\nname: foo\nrequires: [skills/git, commands/bar]\n---\n";
  assert.deepEqual(parseFrontmatter(md), {
    name: "foo",
    description: "",
    requires: ["skills/git", "commands/bar"],
  });
});

test("parseFrontmatter: parses block-array requires form", () => {
  const md =
    "---\n" +
    "name: bar\n" +
    "requires:\n" +
    "  - skills/git-helpers\n" +
    "  - commands/something\n" +
    "---\n";
  assert.deepEqual(parseFrontmatter(md), {
    name: "bar",
    description: "",
    requires: ["skills/git-helpers", "commands/something"],
  });
});

test("parseFrontmatter: strips surrounding single and double quotes from scalars", () => {
  const md = "---\nname: \"quoted name\"\ndescription: 'a description'\n---\n";
  assert.deepEqual(parseFrontmatter(md), {
    name: "quoted name",
    description: "a description",
    requires: [],
  });
});

test("parseFrontmatter: ignores unknown frontmatter keys", () => {
  const md = "---\nname: kept\ntags: [a, b]\nauthor: someone\n---\n";
  assert.deepEqual(parseFrontmatter(md), { name: "kept", description: "", requires: [] });
});

test("parseFrontmatter: returns fallback when there is no leading --- marker", () => {
  const md = "# Heading\n\nSome body without frontmatter.\n";
  assert.deepEqual(parseFrontmatter(md), { name: "", description: "", requires: [] });
});

test("parseFrontmatter: does not throw on malformed input and returns best-effort", () => {
  const md = "---\nname: ok\n: bogus line\n=== not yaml ===\ndescription: still parsed\n---\n";
  const result = parseFrontmatter(md);
  assert.equal(result.name, "ok");
  assert.equal(result.description, "still parsed");
  assert.deepEqual(result.requires, []);
});
