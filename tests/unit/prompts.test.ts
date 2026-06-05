import { test } from "node:test";
import { strict as assert } from "node:assert";
import { url } from "../../src/core/prompts.ts";

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
