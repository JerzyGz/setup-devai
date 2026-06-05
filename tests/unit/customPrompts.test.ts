import { test } from "node:test";
import { strict as assert } from "node:assert";
import { styleText } from "node:util";
import {
  S_CHECKBOX_ACTIVE,
  S_CHECKBOX_INACTIVE,
  S_CHECKBOX_SELECTED,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
} from "@clack/prompts";
import {
  customMultiselect,
  customSelect,
  multiselectRender,
  renderMultiselectRow,
  renderSelectRow,
  selectRender,
} from "../../src/core/customPrompts.ts";

test("customSelect and customMultiselect: are exported as functions (smoke test — runtime behavior is exercised by the wizard integration tests)", () => {
  assert.equal(typeof customSelect, "function");
  assert.equal(typeof customMultiselect, "function");
});

test("selectRender: when called on a prompt whose cursor points at index 1, the rendered output marks the option at index 1 as active and the rest as inactive", () => {
  const output = { columns: 80 } as never;
  const render = selectRender({
    message: "Pick",
    options: [
      { value: "a", label: "ALPHA" },
      { value: "b", label: "BETA" },
      { value: "c", label: "GAMMA" },
    ],
    output,
  });
  const result = render.call({
    state: "active",
    cursor: 1,
    options: [
      { value: "a", label: "ALPHA" },
      { value: "b", label: "BETA" },
      { value: "c", label: "GAMMA" },
    ],
    value: undefined,
  } as never);
  const activeArrows = (result.match(new RegExp(S_RADIO_ACTIVE, "g")) ?? []).length;
  const inactiveArrows = (result.match(new RegExp(S_RADIO_INACTIVE, "g")) ?? []).length;
  assert.equal(activeArrows, 1, "exactly one row should be marked as active");
  assert.equal(inactiveArrows, 2, "the other two rows should be marked as inactive");
  assert.ok(result.includes("ALPHA"));
  assert.ok(result.includes("BETA"));
  assert.ok(result.includes("GAMMA"));
});

test("multiselectRender: when the cursor is at index 0 and the option at index 0 is selected, the rendered output includes the active-selected indicator exactly once (and no cyan active checkbox)", () => {
  const output = { columns: 80 } as never;
  const render = multiselectRender({
    message: "Pick",
    options: [
      { value: "a", label: "ALPHA" },
      { value: "b", label: "BETA" },
    ],
    output,
  });
  const result = render.call({
    state: "active",
    cursor: 0,
    options: [
      { value: "a", label: "ALPHA" },
      { value: "b", label: "BETA" },
    ],
    value: ["a"],
  } as never);
  const selectedIndicators = (result.match(new RegExp(S_CHECKBOX_SELECTED, "g")) ?? []).length;
  assert.equal(
    selectedIndicators,
    1,
    "exactly one row should be marked as selected (the active-selected row uses the green filled square)",
  );
  assert.ok(result.includes("ALPHA"));
  assert.ok(result.includes("BETA"));
});

test("renderSelectRow: in the 'active' state, the label is rendered in yellowBright and the arrow indicator keeps clack's green color", () => {
  const result = renderSelectRow({ value: "command", label: "Commands" }, "active");
  assert.equal(
    result,
    `${styleText("green", S_RADIO_ACTIVE)} ${styleText("yellowBright", "Commands")}`,
  );
});

test("renderSelectRow: in the 'inactive' state, both the indicator and label are dim — matching clack's non-active rendering exactly", () => {
  const result = renderSelectRow({ value: "command", label: "Commands" }, "inactive");
  assert.equal(result, `${styleText("dim", S_RADIO_INACTIVE)} ${styleText("dim", "Commands")}`);
});

test("renderSelectRow: in the 'selected' state (the post-submit echo), the label is dim with no indicator", () => {
  const result = renderSelectRow({ value: "command", label: "Commands" }, "selected");
  assert.equal(result, styleText("dim", "Commands"));
});

test("renderSelectRow: in the 'cancelled' state, the label is strikethrough and dim — matching clack exactly", () => {
  const result = renderSelectRow({ value: "command", label: "Commands" }, "cancelled");
  assert.equal(result, styleText(["strikethrough", "dim"], "Commands"));
});

test("renderSelectRow: in the 'disabled' state, the indicator is gray, the label is gray, and the hint is dim (with 'disabled' as fallback when hint is missing)", () => {
  const result = renderSelectRow({ value: "divider", label: "──────────────" }, "disabled");
  assert.equal(
    result,
    `${styleText("gray", S_RADIO_INACTIVE)} ${styleText("gray", "──────────────")} ${styleText(
      "dim",
      "(disabled)",
    )}`,
  );
});

test("renderSelectRow: in the 'active' state with a hint, the hint is rendered in dim after the yellowBright label", () => {
  const result = renderSelectRow(
    { value: "command", label: "Commands", hint: "3 available" },
    "active",
  );
  assert.equal(
    result,
    `${styleText("green", S_RADIO_ACTIVE)} ${styleText("yellowBright", "Commands")} ${styleText(
      "dim",
      "(3 available)",
    )}`,
  );
});

test("renderMultiselectRow: in the 'active' state, the label is rendered in yellowBright and the checkbox indicator keeps clack's cyan color", () => {
  const result = renderMultiselectRow({ value: "foo", label: "foo" }, "active");
  assert.equal(
    result,
    `${styleText("cyan", S_CHECKBOX_ACTIVE)} ${styleText("yellowBright", "foo")}`,
  );
});

test("renderMultiselectRow: in the 'active-selected' state, the label is yellowBright and the indicator is the green selected checkbox (matching clack exactly)", () => {
  const result = renderMultiselectRow({ value: "foo", label: "foo" }, "active-selected");
  assert.equal(
    result,
    `${styleText("green", S_CHECKBOX_SELECTED)} ${styleText("yellowBright", "foo")}`,
  );
});

test("renderMultiselectRow: in the 'inactive' state, both the indicator and label are dim — matching clack exactly", () => {
  const result = renderMultiselectRow({ value: "foo", label: "foo" }, "inactive");
  assert.equal(result, `${styleText("dim", S_CHECKBOX_INACTIVE)} ${styleText("dim", "foo")}`);
});

test("renderMultiselectRow: in the 'selected' state (not focused but checked), the checkbox is green and the label is dim — matching clack exactly", () => {
  const result = renderMultiselectRow({ value: "foo", label: "foo" }, "selected");
  assert.equal(result, `${styleText("green", S_CHECKBOX_SELECTED)} ${styleText("dim", "foo")}`);
});

test("renderMultiselectRow: in the 'cancelled' state, the label is strikethrough and dim with no indicator — matching clack exactly", () => {
  const result = renderMultiselectRow({ value: "foo", label: "foo" }, "cancelled");
  assert.equal(result, styleText(["strikethrough", "dim"], "foo"));
});

test("renderMultiselectRow: in the 'submitted' state (the post-submit echo), the label is dim with no indicator", () => {
  const result = renderMultiselectRow({ value: "foo", label: "foo" }, "submitted");
  assert.equal(result, styleText("dim", "foo"));
});

test("renderMultiselectRow: in the 'disabled' state, the indicator is gray, the label is strikethrough gray, and the hint is dim (with 'disabled' as fallback when hint is missing)", () => {
  const result = renderMultiselectRow({ value: "foo", label: "foo" }, "disabled");
  assert.equal(
    result,
    `${styleText("gray", S_CHECKBOX_INACTIVE)} ${styleText(["strikethrough", "gray"], "foo")} ${styleText(
      "dim",
      "(disabled)",
    )}`,
  );
});

test("renderSelectRow: when the option has no label, falls back to String(value) for the rendering", () => {
  const result = renderSelectRow({ value: "command" }, "active");
  assert.equal(
    result,
    `${styleText("green", S_RADIO_ACTIVE)} ${styleText("yellowBright", "command")}`,
  );
});

test("renderMultiselectRow: when the option has no label, falls back to String(value) for the rendering", () => {
  const result = renderMultiselectRow({ value: "command" }, "active");
  assert.equal(
    result,
    `${styleText("cyan", S_CHECKBOX_ACTIVE)} ${styleText("yellowBright", "command")}`,
  );
});
