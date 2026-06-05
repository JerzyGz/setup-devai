import { test } from "node:test";
import { strict as assert } from "node:assert";
import { main } from "../src/index.ts";

test("smoke: src/index.ts resolves and exports main()", () => {
  assert.equal(typeof main, "function");
});
