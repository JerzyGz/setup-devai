import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  collisionPrompt,
  itemMultiSelect,
  postInstallSummary,
  preInstallSummary,
  typeMenu,
  url,
} from "../../src/core/prompts.ts";
import type { InstallResult } from "../../src/core/install.ts";
import { opencode } from "../../src/agents/opencode.ts";
import type { Item } from "../../src/types.ts";

function makeItem(partial: Partial<Item> & { id: string; type: Item["type"]; name: string }): Item {
  return {
    id: partial.id,
    type: partial.type,
    name: partial.name,
    description: partial.description ?? "",
    path: partial.path ?? `/tmp/${partial.id}`,
    isDirectory: partial.isDirectory ?? false,
    frontmatter: partial.frontmatter ?? {
      name: partial.name,
      description: partial.description ?? "",
      requires: [],
    },
  };
}

test("url: returns the trimmed text input from @clack/prompts.text", async () => {
  const fakeText = async (): Promise<string | symbol> => "  https://github.com/user/repo  ";
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const result = await url({ text: fakeText, isCancel: fakeIsCancel });
  assert.equal(result, "https://github.com/user/repo");
});

test("url: re-prompts when the user submits empty or whitespace-only input", async () => {
  const responses: (string | symbol)[] = ["", "   ", "https://github.com/x/y"];
  let calls = 0;
  const fakeText = async (): Promise<string | symbol> => {
    const next = responses[calls];
    calls += 1;
    return next as string | symbol;
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const result = await url({ text: fakeText, isCancel: fakeIsCancel });
  assert.equal(result, "https://github.com/x/y");
  assert.equal(
    calls,
    3,
    "text should have been called once per empty submission plus the valid one",
  );
});

test("url: throws 'User cancelled' when the user cancels the prompt", async () => {
  const cancelSymbol = Symbol("clack:cancel");
  const fakeText = async (): Promise<string | symbol> => cancelSymbol;
  const fakeIsCancel = (v: unknown): v is symbol => v === cancelSymbol;
  await assert.rejects(() => url({ text: fakeText, isCancel: fakeIsCancel }), /User cancelled/);
});

test("url: calls @clack/prompts.text with the locked placeholder", async () => {
  let capturedOpts: { message: string; placeholder?: string } | undefined;
  const fakeText = async (opts: {
    message: string;
    placeholder?: string;
  }): Promise<string | symbol> => {
    capturedOpts = opts;
    return "https://github.com/x/y";
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await url({ text: fakeText, isCancel: fakeIsCancel });
  assert.equal(capturedOpts?.placeholder, "https://github.com/you/your-registry");
});

test("typeMenu: returns the value the user selects", async () => {
  const items = [
    makeItem({ id: "commands/foo", type: "command", name: "foo" }),
    makeItem({ id: "agents/bar", type: "agent", name: "bar" }),
  ];
  const fakeSelect = async (_opts: unknown): Promise<unknown> => "command";
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const result = await typeMenu(items, opencode, {
    select: fakeSelect as never,
    isCancel: fakeIsCancel,
  });
  assert.equal(result, "command");
});

test("typeMenu: includes one option per non-empty type, hides empty types", async () => {
  const items = [
    makeItem({ id: "commands/a", type: "command", name: "a" }),
    makeItem({ id: "commands/b", type: "command", name: "b" }),
    makeItem({ id: "skills/c", type: "skill", name: "c" }),
  ];
  let captured: { options: Array<{ value: unknown }> } | undefined;
  const fakeSelect = async (opts: unknown): Promise<unknown> => {
    captured = opts as { options: Array<{ value: unknown }> };
    return "command";
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await typeMenu(items, opencode, { select: fakeSelect as never, isCancel: fakeIsCancel });
  const values = captured?.options.map((o) => o.value);
  assert.ok(values?.includes("command"), "expected a 'command' option");
  assert.ok(values?.includes("skill"), "expected a 'skill' option");
  assert.ok(!values?.includes("agent"), "did not expect an 'agent' option (zero items)");
});

test("typeMenu: labels each type option with the profile label and a count hint", async () => {
  const items = [
    makeItem({ id: "commands/a", type: "command", name: "a" }),
    makeItem({ id: "commands/b", type: "command", name: "b" }),
    makeItem({ id: "commands/c", type: "command", name: "c" }),
    makeItem({ id: "agents/d", type: "agent", name: "d" }),
  ];
  let captured: { options: Array<{ value: unknown; label?: string; hint?: string }> } | undefined;
  const fakeSelect = async (opts: unknown): Promise<unknown> => {
    captured = opts as { options: Array<{ value: unknown; label?: string; hint?: string }> };
    return "command";
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await typeMenu(items, opencode, { select: fakeSelect as never, isCancel: fakeIsCancel });
  const command = captured?.options.find((o) => o.value === "command");
  const agent = captured?.options.find((o) => o.value === "agent");
  assert.equal(command?.label, "Commands (3)");
  assert.equal(agent?.label, "Agents / Subagents (1)");
});

test("typeMenu: lists a divider followed by [ Install ] as the final entry", async () => {
  const items = [
    makeItem({ id: "commands/a", type: "command", name: "a" }),
    makeItem({ id: "agents/b", type: "agent", name: "b" }),
  ];
  let captured:
    | {
        options: Array<{ value: unknown; label?: string; disabled?: boolean }>;
      }
    | undefined;
  const fakeSelect = async (opts: unknown): Promise<unknown> => {
    captured = opts as {
      options: Array<{ value: unknown; label?: string; disabled?: boolean }>;
    };
    return "install";
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const result = await typeMenu(items, opencode, {
    select: fakeSelect as never,
    isCancel: fakeIsCancel,
  });
  assert.equal(result, "install");
  const options = captured?.options ?? [];
  const installIndex = options.findIndex((o) => o.value === "install");
  assert.ok(installIndex > 0, "[ Install ] should not be the first option");
  assert.equal(installIndex, options.length - 1, "[ Install ] should be the last option");
  const divider = options[installIndex - 1];
  assert.equal(
    divider?.disabled,
    true,
    "the option before [ Install ] should be a disabled divider",
  );
  assert.equal(options[installIndex]?.label, "[ Install ]");
});

test("typeMenu: throws 'User cancelled' when the user cancels", async () => {
  const cancelSymbol = Symbol("clack:cancel");
  const fakeSelect = async (_opts: unknown): Promise<unknown> => cancelSymbol;
  const fakeIsCancel = (v: unknown): v is symbol => v === cancelSymbol;
  await assert.rejects(
    () =>
      typeMenu([makeItem({ id: "commands/a", type: "command", name: "a" })], opencode, {
        select: fakeSelect as never,
        isCancel: fakeIsCancel,
      }),
    /User cancelled/,
  );
});

test("itemMultiSelect: builds an option per item of the chosen type using name as label and description as hint", async () => {
  const foo = makeItem({
    id: "commands/foo",
    type: "command",
    name: "foo",
    description: "The foo command",
  });
  const bar = makeItem({
    id: "commands/bar",
    type: "command",
    name: "bar",
    description: "The bar command",
  });
  const otherType = makeItem({ id: "agents/baz", type: "agent", name: "baz" });
  let captured:
    | {
        options: Array<{ value: unknown; label?: string; hint?: string }>;
        initialValues?: unknown[];
      }
    | undefined;
  const fakeMultiselect = async (opts: unknown): Promise<unknown> => {
    captured = opts as {
      options: Array<{ value: unknown; label?: string; hint?: string }>;
      initialValues?: unknown[];
    };
    return [foo];
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const result = await itemMultiSelect([foo, bar, otherType], "command", opencode, [], {
    multiselect: fakeMultiselect as never,
    isCancel: fakeIsCancel,
  });
  assert.deepEqual(result, [foo]);
  const options = captured?.options ?? [];
  assert.equal(options.length, 2, "should only include items of the chosen type");
  const fooOpt = options.find((o) => o.value === foo);
  const barOpt = options.find((o) => o.value === bar);
  assert.equal(fooOpt?.label, "foo");
  assert.equal(fooOpt?.hint, "The foo command");
  assert.equal(barOpt?.label, "bar");
  assert.equal(barOpt?.hint, "The bar command");
});

test("itemMultiSelect: with no prior selections, initialValues is empty", async () => {
  const foo = makeItem({ id: "commands/foo", type: "command", name: "foo" });
  let captured: { initialValues?: unknown[] } | undefined;
  const fakeMultiselect = async (opts: unknown): Promise<unknown> => {
    captured = opts as { initialValues?: unknown[] };
    return [];
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await itemMultiSelect([foo], "command", opencode, [], {
    multiselect: fakeMultiselect as never,
    isCancel: fakeIsCancel,
  });
  assert.deepEqual(captured?.initialValues ?? [], []);
});

test("itemMultiSelect: on re-entry, prior selections of the same type are pre-checked", async () => {
  const foo = makeItem({ id: "commands/foo", type: "command", name: "foo" });
  const bar = makeItem({ id: "commands/bar", type: "command", name: "bar" });
  let captured: { initialValues?: unknown[] } | undefined;
  const fakeMultiselect = async (opts: unknown): Promise<unknown> => {
    captured = opts as { initialValues?: unknown[] };
    return [foo];
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await itemMultiSelect([foo, bar], "command", opencode, [foo], {
    multiselect: fakeMultiselect as never,
    isCancel: fakeIsCancel,
  });
  assert.deepEqual(captured?.initialValues, [foo]);
});

test("itemMultiSelect: prior selections of a different type are ignored", async () => {
  const fooCmd = makeItem({ id: "commands/foo", type: "command", name: "foo" });
  const otherAgent = makeItem({ id: "agents/other", type: "agent", name: "other" });
  let captured: { initialValues?: unknown[] } | undefined;
  const fakeMultiselect = async (opts: unknown): Promise<unknown> => {
    captured = opts as { initialValues?: unknown[] };
    return [];
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await itemMultiSelect([fooCmd, otherAgent], "command", opencode, [otherAgent], {
    multiselect: fakeMultiselect as never,
    isCancel: fakeIsCancel,
  });
  assert.deepEqual(captured?.initialValues ?? [], []);
});

test("itemMultiSelect: required items (same type) of prior selections are pre-checked", async () => {
  const dep = makeItem({ id: "commands/dep", type: "command", name: "dep" });
  const root = makeItem({
    id: "commands/root",
    type: "command",
    name: "root",
    frontmatter: { name: "root", description: "", requires: ["commands/dep"] },
  });
  let captured: { initialValues?: unknown[] } | undefined;
  const fakeMultiselect = async (opts: unknown): Promise<unknown> => {
    captured = opts as { initialValues?: unknown[] };
    return [];
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await itemMultiSelect([root, dep], "command", opencode, [root], {
    multiselect: fakeMultiselect as never,
    isCancel: fakeIsCancel,
  });
  const initial = (captured?.initialValues ?? []) as Item[];
  assert.ok(initial.includes(root), "root should be pre-checked");
  assert.ok(initial.includes(dep), "dep should be pre-checked via requires");
});

test("itemMultiSelect: requires are followed transitively (A requires B, B requires C)", async () => {
  const c = makeItem({ id: "commands/c", type: "command", name: "c" });
  const b = makeItem({
    id: "commands/b",
    type: "command",
    name: "b",
    frontmatter: { name: "b", description: "", requires: ["commands/c"] },
  });
  const a = makeItem({
    id: "commands/a",
    type: "command",
    name: "a",
    frontmatter: { name: "a", description: "", requires: ["commands/b"] },
  });
  let captured: { initialValues?: unknown[] } | undefined;
  const fakeMultiselect = async (opts: unknown): Promise<unknown> => {
    captured = opts as { initialValues?: unknown[] };
    return [];
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await itemMultiSelect([a, b, c], "command", opencode, [a], {
    multiselect: fakeMultiselect as never,
    isCancel: fakeIsCancel,
  });
  const initial = (captured?.initialValues ?? []) as Item[];
  assert.ok(initial.includes(a) && initial.includes(b) && initial.includes(c));
});

test("itemMultiSelect: requires cycle does not infinite-loop", async () => {
  const x = makeItem({
    id: "commands/x",
    type: "command",
    name: "x",
    frontmatter: { name: "x", description: "", requires: ["commands/y"] },
  });
  const y = makeItem({
    id: "commands/y",
    type: "command",
    name: "y",
    frontmatter: { name: "y", description: "", requires: ["commands/x"] },
  });
  let captured: { initialValues?: unknown[] } | undefined;
  const fakeMultiselect = async (opts: unknown): Promise<unknown> => {
    captured = opts as { initialValues?: unknown[] };
    return [];
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await itemMultiSelect([x, y], "command", opencode, [x], {
    multiselect: fakeMultiselect as never,
    isCancel: fakeIsCancel,
  });
  const initial = (captured?.initialValues ?? []) as Item[];
  assert.ok(initial.includes(x) && initial.includes(y));
  assert.equal(initial.length, 2);
});

function captureStderr(): { restore: () => void; output: () => string } {
  const original = process.stderr.write.bind(process.stderr);
  const chunks: string[] = [];
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  return {
    restore: () => {
      process.stderr.write = original;
    },
    output: () => chunks.join(""),
  };
}

test("itemMultiSelect: cross-type requires emit a stderr warning and are NOT pre-checked", async () => {
  const helperAgent = makeItem({
    id: "agents/helper",
    type: "agent",
    name: "helper",
  });
  const root = makeItem({
    id: "commands/root",
    type: "command",
    name: "root",
    frontmatter: { name: "root", description: "", requires: ["agents/helper"] },
  });
  let captured: { initialValues?: unknown[] } | undefined;
  const fakeMultiselect = async (opts: unknown): Promise<unknown> => {
    captured = opts as { initialValues?: unknown[] };
    return [];
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const cap = captureStderr();
  try {
    await itemMultiSelect([root, helperAgent], "command", opencode, [root], {
      multiselect: fakeMultiselect as never,
      isCancel: fakeIsCancel,
    });
  } finally {
    cap.restore();
  }
  const initial = (captured?.initialValues ?? []) as Item[];
  assert.ok(initial.includes(root));
  assert.ok(!initial.includes(helperAgent), "cross-type required should not be pre-checked");
  const stderr = cap.output();
  assert.match(stderr, /root/, "warning should name the depending item");
  assert.match(stderr, /agents\/helper/, "warning should name the missing target id");
  assert.match(stderr, /cross-type/i, "warning should call out cross-type");
});

test("itemMultiSelect: unknown requires emit a stderr warning and are NOT pre-checked", async () => {
  const root = makeItem({
    id: "commands/root",
    type: "command",
    name: "root",
    frontmatter: { name: "root", description: "", requires: ["commands/missing"] },
  });
  const fakeMultiselect = async (_opts: unknown): Promise<unknown> => [];
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const cap = captureStderr();
  try {
    await itemMultiSelect([root], "command", opencode, [root], {
      multiselect: fakeMultiselect as never,
      isCancel: fakeIsCancel,
    });
  } finally {
    cap.restore();
  }
  const stderr = cap.output();
  assert.match(stderr, /commands\/missing/);
  assert.match(stderr, /root/);
});

test("itemMultiSelect: cross-type warning is emitted at most once per unique missing target", async () => {
  const helper = makeItem({ id: "agents/helper", type: "agent", name: "helper" });
  const a = makeItem({
    id: "commands/a",
    type: "command",
    name: "a",
    frontmatter: { name: "a", description: "", requires: ["agents/helper"] },
  });
  const b = makeItem({
    id: "commands/b",
    type: "command",
    name: "b",
    frontmatter: { name: "b", description: "", requires: ["agents/helper"] },
  });
  const fakeMultiselect = async (_opts: unknown): Promise<unknown> => [];
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const cap = captureStderr();
  try {
    await itemMultiSelect([a, b, helper], "command", opencode, [a, b], {
      multiselect: fakeMultiselect as never,
      isCancel: fakeIsCancel,
    });
  } finally {
    cap.restore();
  }
  const stderr = cap.output();
  const matches = stderr.match(/agents\/helper/g) ?? [];
  assert.equal(matches.length, 1, `expected exactly one warning for agents/helper, got: ${stderr}`);
});

test("itemMultiSelect: throws 'User cancelled' when the user cancels", async () => {
  const cancelSymbol = Symbol("clack:cancel");
  const fakeMultiselect = async (_opts: unknown): Promise<unknown> => cancelSymbol;
  const fakeIsCancel = (v: unknown): v is symbol => v === cancelSymbol;
  await assert.rejects(
    () =>
      itemMultiSelect(
        [makeItem({ id: "commands/a", type: "command", name: "a" })],
        "command",
        opencode,
        [],
        {
          multiselect: fakeMultiselect as never,
          isCancel: fakeIsCancel,
        },
      ),
    /User cancelled/,
  );
});

test("itemMultiSelect: respects the user's returned subset (un-checking a pre-checked required item)", async () => {
  const dep = makeItem({ id: "commands/dep", type: "command", name: "dep" });
  const root = makeItem({
    id: "commands/root",
    type: "command",
    name: "root",
    frontmatter: { name: "root", description: "", requires: ["commands/dep"] },
  });
  const fakeMultiselect = async (_opts: unknown): Promise<unknown> => [root];
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const result = await itemMultiSelect([root, dep], "command", opencode, [root], {
    multiselect: fakeMultiselect as never,
    isCancel: fakeIsCancel,
  });
  assert.deepEqual(result, [root]);
});

test("preInstallSummary: with empty selections and zero collisions, renders the basic structure to the log", async () => {
  const messages: string[] = [];
  const fakeLog = (msg: string): void => {
    messages.push(msg);
  };
  const fakeCancel = async (_opts: unknown): Promise<unknown> => true;
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await preInstallSummary(
    [],
    { paths: [], items: [], byType: { command: [], agent: [], skill: [] } },
    "/abs/target",
    opencode,
    {
      log: fakeLog as never,
      cancel: fakeCancel as never,
      isCancel: fakeIsCancel,
    },
  );
  const joined = messages.join("\n");
  assert.match(joined, /Target: \/abs\/target/);
  assert.match(joined, /Selected \(0\):/);
  assert.match(joined, /Collisions: 0 existing items will be overwritten/);
});

test("preInstallSummary: groups selections by type in canonical order, with counts and comma-separated names", async () => {
  const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });
  const minimal = makeItem({ id: "commands/minimal", type: "command", name: "minimal" });
  const doc = makeItem({ id: "agents/document-writer", type: "agent", name: "document-writer" });
  const commit = makeItem({ id: "skills/commit", type: "skill", name: "commit" });
  const messages: string[] = [];
  const fakeLog = (msg: string): void => {
    messages.push(msg);
  };
  const fakeCancel = async (_opts: unknown): Promise<unknown> => true;
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await preInstallSummary(
    [grillMe, doc, minimal, commit],
    { paths: [], items: [], byType: { command: [], agent: [], skill: [] } },
    "/abs/target",
    opencode,
    {
      log: fakeLog as never,
      cancel: fakeCancel as never,
      isCancel: fakeIsCancel,
    },
  );
  const joined = messages.join("\n");
  assert.match(joined, /Selected \(4\):/);
  assert.match(joined, /Commands \(2\): grill-me, minimal/);
  assert.match(joined, /Agents \/ Subagents \(1\): document-writer/);
  assert.match(joined, /Skills \(1\): commit/);
  const cmdIdx = joined.indexOf("Commands (2)");
  const agentIdx = joined.indexOf("Agents / Subagents (1)");
  const skillIdx = joined.indexOf("Skills (1)");
  assert.ok(
    cmdIdx > 0 && agentIdx > cmdIdx && skillIdx > agentIdx,
    "groups should be in command, agent, skill order",
  );
});

test("preInstallSummary: with a non-empty collision report, lists each path on its own line", async () => {
  const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });
  const commit = makeItem({ id: "skills/commit", type: "skill", name: "commit" });
  const messages: string[] = [];
  const fakeLog = (msg: string): void => {
    messages.push(msg);
  };
  const fakeCancel = async (_opts: unknown): Promise<unknown> => true;
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const report = {
    paths: ["/abs/target/.opencode/command/grill-me.md", "/abs/target/.opencode/skill/commit"],
    items: [grillMe, commit],
    byType: { command: [grillMe], agent: [], skill: [commit] },
  };
  await preInstallSummary([grillMe, commit], report, "/abs/target", opencode, {
    log: fakeLog as never,
    cancel: fakeCancel as never,
    isCancel: fakeIsCancel,
  });
  const joined = messages.join("\n");
  assert.match(joined, /Collisions: 2 existing items will be overwritten/);
  assert.match(joined, /\n  \/abs\/target\/.opencode\/command\/grill-me\.md/);
  assert.match(joined, /\n  \/abs\/target\/.opencode\/skill\/commit/);
});

test("preInstallSummary: throws 'User cancelled' when the user cancels the Enter prompt", async () => {
  const cancelSymbol = Symbol("clack:cancel");
  const fakeLog = (_msg: string): void => {};
  const fakeCancel = async (_opts: unknown): Promise<unknown> => cancelSymbol;
  const fakeIsCancel = (v: unknown): v is symbol => v === cancelSymbol;
  await assert.rejects(
    () =>
      preInstallSummary(
        [],
        { paths: [], items: [], byType: { command: [], agent: [], skill: [] } },
        "/abs/target",
        opencode,
        {
          log: fakeLog as never,
          cancel: fakeCancel as never,
          isCancel: fakeIsCancel,
        },
      ),
    /User cancelled/,
  );
});

test("collisionPrompt: returns the 'yes' value when the mocked select returns 'yes'", async () => {
  const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });
  const fakeSelect = async (_opts: unknown): Promise<unknown> => "yes";
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const result = await collisionPrompt(grillMe, "/abs/target/.opencode/command/grill-me.md", {
    select: fakeSelect as never,
    isCancel: fakeIsCancel,
  });
  assert.equal(result, "yes");
});

test("collisionPrompt: returns 'no' when the mocked select returns 'no'", async () => {
  const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });
  const fakeSelect = async (_opts: unknown): Promise<unknown> => "no";
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const result = await collisionPrompt(grillMe, "/abs/target/.opencode/command/grill-me.md", {
    select: fakeSelect as never,
    isCancel: fakeIsCancel,
  });
  assert.equal(result, "no");
});

test("collisionPrompt: returns 'yes-all' when the mocked select returns 'yes-all'", async () => {
  const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });
  const fakeSelect = async (_opts: unknown): Promise<unknown> => "yes-all";
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const result = await collisionPrompt(grillMe, "/abs/target/.opencode/command/grill-me.md", {
    select: fakeSelect as never,
    isCancel: fakeIsCancel,
  });
  assert.equal(result, "yes-all");
});

test("collisionPrompt: returns 'no-all' when the mocked select returns 'no-all'", async () => {
  const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });
  const fakeSelect = async (_opts: unknown): Promise<unknown> => "no-all";
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  const result = await collisionPrompt(grillMe, "/abs/target/.opencode/command/grill-me.md", {
    select: fakeSelect as never,
    isCancel: fakeIsCancel,
  });
  assert.equal(result, "no-all");
});

test("collisionPrompt: returns null when the mocked select returns the cancel symbol", async () => {
  const cancelSymbol = Symbol("clack:cancel");
  const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });
  const fakeSelect = async (_opts: unknown): Promise<unknown> => cancelSymbol;
  const fakeIsCancel = (v: unknown): v is symbol => v === cancelSymbol;
  const result = await collisionPrompt(grillMe, "/abs/target/.opencode/command/grill-me.md", {
    select: fakeSelect as never,
    isCancel: fakeIsCancel,
  });
  assert.equal(result, null);
});

test("collisionPrompt: presents four visible options (yes, no, yes-all, no-all) in the locked order with the locked labels and hints", async () => {
  const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });
  let captured:
    | {
        options: Array<{ value: unknown; label?: string; hint?: string }>;
        message?: string;
      }
    | undefined;
  const fakeSelect = async (opts: unknown): Promise<unknown> => {
    captured = opts as {
      options: Array<{ value: unknown; label?: string; hint?: string }>;
      message?: string;
    };
    return "yes";
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await collisionPrompt(grillMe, "/abs/target/.opencode/command/grill-me.md", {
    select: fakeSelect as never,
    isCancel: fakeIsCancel,
  });
  const values = captured?.options.map((o) => o.value) ?? [];
  assert.deepEqual(values, ["yes", "no", "yes-all", "no-all"]);
  const labels = captured?.options.map((o) => o.label) ?? [];
  assert.deepEqual(labels, ["Yes", "No", "Yes to all", "No to all"]);
  const hints = captured?.options.map((o) => o.hint) ?? [];
  assert.equal(hints[0], "Overwrite this item");
  assert.equal(hints[1], "Skip this item");
  assert.equal(hints[2], "Overwrite all remaining collisions");
  assert.equal(hints[3], "Skip all remaining collisions");
});

test("collisionPrompt: message names the item and the existing path", async () => {
  const grillMe = makeItem({ id: "commands/grill-me", type: "command", name: "grill-me" });
  let captured: { message?: string } | undefined;
  const fakeSelect = async (opts: unknown): Promise<unknown> => {
    captured = opts as { message?: string };
    return "yes";
  };
  const fakeIsCancel = (_v: unknown): _v is symbol => false;
  await collisionPrompt(grillMe, "/abs/target/.opencode/command/grill-me.md", {
    select: fakeSelect as never,
    isCancel: fakeIsCancel,
  });
  assert.match(captured?.message ?? "", /grill-me/);
  assert.match(captured?.message ?? "", /\/abs\/target\/.opencode\/command\/grill-me\.md/);
});

function makeFakeLog(): {
  log: { success: (msg: string) => void; error: (msg: string) => void };
  successMessages: string[];
  errorMessages: string[];
} {
  const successMessages: string[] = [];
  const errorMessages: string[] = [];
  return {
    log: {
      success: (msg: string): void => {
        successMessages.push(msg);
      },
      error: (msg: string): void => {
        errorMessages.push(msg);
      },
    },
    successMessages,
    errorMessages,
  };
}

test("postInstallSummary: prints 'Installed N items to <targetPath>' header via log.success", () => {
  const { log, successMessages } = makeFakeLog();
  const results: InstallResult[] = [];
  postInstallSummary([], results, "/abs/target", opencode, { log: log as never });
  const joined = successMessages.join("\n");
  assert.match(joined, /Installed 0 items to \/abs\/target/);
});

test("postInstallSummary: lists per-type counts for installed items using profile labels in command/agent/skill order", () => {
  const { log, successMessages } = makeFakeLog();
  const cmdA = makeItem({ id: "commands/a", type: "command", name: "a" });
  const cmdB = makeItem({ id: "commands/b", type: "command", name: "b" });
  const agentA = makeItem({ id: "agents/d", type: "agent", name: "d" });
  const skillA = makeItem({ id: "skills/c", type: "skill", name: "c" });
  const results: InstallResult[] = [
    { status: "installed" },
    { status: "installed" },
    { status: "installed" },
    { status: "installed" },
  ];
  postInstallSummary([cmdA, cmdB, agentA, skillA], results, "/abs/target", opencode, {
    log: log as never,
  });
  const joined = successMessages.join("\n");
  assert.match(joined, /Installed 4 items to \/abs\/target/);
  assert.match(joined, /2 Commands/);
  assert.match(joined, /1 Agents \/ Subagents/);
  assert.match(joined, /1 Skills/);
  const cmdIdx = joined.indexOf("Commands");
  const agentIdx = joined.indexOf("Agents / Subagents");
  const skillIdx = joined.indexOf("Skills");
  assert.ok(
    cmdIdx > 0 && agentIdx > cmdIdx && skillIdx > agentIdx,
    "per-type lines should be in command, agent, skill order",
  );
});

test("postInstallSummary: shows 'Skipped M' and 'Failed K' counts in the body", () => {
  const { log, successMessages } = makeFakeLog();
  const a = makeItem({ id: "commands/a", type: "command", name: "a" });
  const b = makeItem({ id: "commands/b", type: "command", name: "b" });
  const c = makeItem({ id: "commands/c", type: "command", name: "c" });
  const results: InstallResult[] = [
    { status: "installed" },
    { status: "skipped", reason: "collision-declined" },
    { status: "failed", reason: "EACCES: permission denied" },
  ];
  postInstallSummary([a, b, c], results, "/abs/target", opencode, { log: log as never });
  const joined = successMessages.join("\n");
  assert.match(joined, /Installed 1 items to \/abs\/target/);
  assert.match(joined, /Skipped 1/);
  assert.match(joined, /Failed 1/);
});

test("postInstallSummary: calls log.error with a 'X item(s) failed — see above' message when at least one item failed", () => {
  const { log, errorMessages } = makeFakeLog();
  const a = makeItem({ id: "commands/a", type: "command", name: "a" });
  const b = makeItem({ id: "commands/b", type: "command", name: "b" });
  const results: InstallResult[] = [
    { status: "installed" },
    { status: "failed", reason: "EACCES: permission denied" },
    { status: "failed", reason: "EPERM: operation not permitted" },
  ];
  postInstallSummary([a, b], results, "/abs/target", opencode, { log: log as never });
  assert.equal(errorMessages.length, 1, "log.error should be called exactly once");
  assert.match(errorMessages[0] ?? "", /2 item\(s\) failed — see above/);
});

test("postInstallSummary: when no item failed, does not call log.error", () => {
  const { log, errorMessages } = makeFakeLog();
  const a = makeItem({ id: "commands/a", type: "command", name: "a" });
  const results: InstallResult[] = [{ status: "installed" }];
  postInstallSummary([a], results, "/abs/target", opencode, { log: log as never });
  assert.equal(errorMessages.length, 0, "log.error should not be called when no failures");
});
