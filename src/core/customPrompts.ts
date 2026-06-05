import { styleText } from "node:util";
import { MultiSelectPrompt, SelectPrompt, settings, wrapTextWithPrefix } from "@clack/core";
import {
  limitOptions,
  S_BAR,
  S_BAR_END,
  S_CHECKBOX_ACTIVE,
  S_CHECKBOX_INACTIVE,
  S_CHECKBOX_SELECTED,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  symbol,
  symbolBar,
} from "@clack/prompts";
import type { MultiSelectOptions, SelectOptions } from "@clack/prompts";

export type SelectRowState = "active" | "inactive" | "selected" | "cancelled" | "disabled";

export type MultiselectRowState =
  | "active"
  | "inactive"
  | "active-selected"
  | "selected"
  | "cancelled"
  | "submitted"
  | "disabled";

export interface RowOption {
  value: unknown;
  label?: string;
  hint?: string;
  disabled?: boolean;
}

export function renderSelectRow(option: RowOption, state: SelectRowState): string {
  const label = option.label ?? String(option.value);
  if (state === "active") {
    const hintPart = option.hint ? ` ${styleText("dim", `(${option.hint})`)}` : "";
    return `${styleText("green", S_RADIO_ACTIVE)} ${styleText("yellowBright", label)}${hintPart}`;
  }
  if (state === "inactive") {
    return `${styleText("dim", S_RADIO_INACTIVE)} ${styleText("dim", label)}`;
  }
  if (state === "selected") {
    return styleText("dim", label);
  }
  if (state === "cancelled") {
    return styleText(["strikethrough", "dim"], label);
  }
  if (state === "disabled") {
    const hintText = option.hint ?? "disabled";
    return `${styleText("gray", S_RADIO_INACTIVE)} ${styleText("gray", label)} ${styleText("dim", `(${hintText})`)}`;
  }
  throw new Error(`renderSelectRow: unhandled state ${state as string}`);
}

export function renderMultiselectRow(option: RowOption, state: MultiselectRowState): string {
  const label = option.label ?? String(option.value);
  if (state === "active") {
    const hintPart = option.hint ? ` ${styleText("dim", `(${option.hint})`)}` : "";
    return `${styleText("cyan", S_CHECKBOX_ACTIVE)} ${styleText("yellowBright", label)}${hintPart}`;
  }
  if (state === "active-selected") {
    const hintPart = option.hint ? ` ${styleText("dim", `(${option.hint})`)}` : "";
    return `${styleText("green", S_CHECKBOX_SELECTED)} ${styleText("yellowBright", label)}${hintPart}`;
  }
  if (state === "inactive") {
    return `${styleText("dim", S_CHECKBOX_INACTIVE)} ${styleText("dim", label)}`;
  }
  if (state === "selected") {
    const hintPart = option.hint ? ` ${styleText("dim", `(${option.hint})`)}` : "";
    return `${styleText("green", S_CHECKBOX_SELECTED)} ${styleText("dim", label)}${hintPart}`;
  }
  if (state === "cancelled") {
    return styleText(["strikethrough", "dim"], label);
  }
  if (state === "submitted") {
    return styleText("dim", label);
  }
  if (state === "disabled") {
    const hintText = option.hint ?? "disabled";
    return `${styleText("gray", S_CHECKBOX_INACTIVE)} ${styleText(["strikethrough", "gray"], label)} ${styleText("dim", `(${hintText})`)}`;
  }
  throw new Error(`renderMultiselectRow: unhandled state ${state as string}`);
}

interface ClackOptionShape {
  value: unknown;
  label?: string;
  hint?: string;
  disabled?: boolean;
}

export function customSelect<Value>(opts: SelectOptions<Value>): Promise<Value | symbol> {
  const prompt = new SelectPrompt<ClackOptionShape>({
    options: opts.options as ClackOptionShape[],
    signal: opts.signal,
    input: opts.input,
    output: opts.output,
    initialValue: opts.initialValue as unknown,
    render: selectRender(opts),
  });
  return prompt.prompt() as Promise<Value | symbol>;
}

export function customMultiselect<Value>(
  opts: MultiSelectOptions<Value>,
): Promise<Value[] | symbol> {
  const required = opts.required ?? true;
  const prompt = new MultiSelectPrompt<ClackOptionShape>({
    options: opts.options as ClackOptionShape[],
    signal: opts.signal,
    input: opts.input,
    output: opts.output,
    initialValues: opts.initialValues as unknown[] | undefined,
    required,
    cursorAt: opts.cursorAt as unknown,
    validate(value) {
      if (required && (value === void 0 || (value as unknown[]).length === 0)) {
        return `Please select at least one option.
${styleText(
  "reset",
  styleText(
    "dim",
    `Press ${styleText(["gray", "bgWhite", "inverse"], " space ")} to select, ${styleText(
      "gray",
      styleText(["bgWhite", "inverse"], " enter "),
    )} to submit`,
  ),
)}`;
      }
    },
    render: multiselectRender(opts),
  });
  return prompt.prompt() as Promise<Value[] | symbol>;
}

type SelectPromptInstance = SelectPrompt<ClackOptionShape>;

export function selectRender(opts: SelectOptions<unknown>) {
  return function (this: SelectPromptInstance): string {
    const withGuide = opts.withGuide ?? settings.withGuide;
    const startPrefix = `${symbol(this.state)}  `;
    const guidePrefix = `${symbolBar(this.state)}  `;
    const header = wrapTextWithPrefix(opts.output, opts.message, guidePrefix, startPrefix);
    const headerBlock = `${withGuide ? `${styleText("gray", S_BAR)}\n` : ""}${header}\n`;
    switch (this.state) {
      case "submit": {
        const continuation = withGuide ? `${styleText("gray", S_BAR)}  ` : "";
        const echo = wrapTextWithPrefix(
          opts.output,
          renderSelectRow(this.options[this.cursor] ?? { value: undefined }, "selected"),
          continuation,
        );
        return `${headerBlock}${echo}`;
      }
      case "cancel": {
        const continuation = withGuide ? `${styleText("gray", S_BAR)}  ` : "";
        const echo = wrapTextWithPrefix(
          opts.output,
          renderSelectRow(this.options[this.cursor] ?? { value: undefined }, "cancelled"),
          continuation,
        );
        return `${headerBlock}${echo}${withGuide ? `\n${styleText("gray", S_BAR)}` : ""}`;
      }
      default: {
        const indent = withGuide ? `${styleText("cyan", S_BAR)}  ` : "";
        const footer = withGuide ? styleText("cyan", S_BAR_END) : "";
        const headerLines = headerBlock.split("\n").length;
        const footerLines = withGuide ? 2 : 1;
        const rows = limitOptions({
          output: opts.output,
          cursor: this.cursor,
          options: this.options,
          maxItems: opts.maxItems,
          columnPadding: indent.length,
          rowPadding: headerLines + footerLines,
          style: (option, isActive) =>
            renderSelectRow(
              option,
              option.disabled ? "disabled" : isActive ? "active" : "inactive",
            ),
        });
        return `${headerBlock}${indent}${rows.join(`\n${indent}`)}\n${footer}\n`;
      }
    }
  };
}

type MultiSelectPromptInstance = MultiSelectPrompt<ClackOptionShape>;

export function multiselectRender(opts: MultiSelectOptions<unknown>) {
  return function (this: MultiSelectPromptInstance): string {
    const withGuide = opts.withGuide ?? settings.withGuide;
    const startPrefix = `${symbol(this.state)}  `;
    const guidePrefix = `${symbolBar(this.state)}  `;
    const header = wrapTextWithPrefix(opts.output, opts.message, guidePrefix, startPrefix);
    const headerBlock = `${withGuide ? `${styleText("gray", S_BAR)}\n` : ""}${header}\n`;
    const selected = (this.value as unknown[] | undefined) ?? [];
    const stateFor = (option: ClackOptionShape, isActive: boolean): MultiselectRowState => {
      if (option.disabled) return "disabled";
      const isSelected = selected.includes(option.value);
      if (isActive && isSelected) return "active-selected";
      if (isSelected) return "selected";
      return isActive ? "active" : "inactive";
    };
    switch (this.state) {
      case "submit": {
        const continuation = withGuide ? `${styleText("gray", S_BAR)}  ` : "";
        const items =
          this.options
            .filter((option) => selected.includes(option.value))
            .map((option) => renderMultiselectRow(option, "submitted"))
            .join(styleText("dim", ", ")) || styleText("dim", "none");
        const echo = wrapTextWithPrefix(opts.output, items, continuation);
        return `${headerBlock}${echo}`;
      }
      case "cancel": {
        const continuation = withGuide ? `${styleText("gray", S_BAR)}  ` : "";
        const items = this.options
          .filter((option) => selected.includes(option.value))
          .map((option) => renderMultiselectRow(option, "cancelled"))
          .join(styleText("dim", ", "));
        if (items.trim() === "") {
          return `${headerBlock}${styleText("gray", S_BAR)}`;
        }
        const echo = wrapTextWithPrefix(opts.output, items, continuation);
        return `${headerBlock}${echo}${withGuide ? `\n${styleText("gray", S_BAR)}` : ""}`;
      }
      case "error": {
        const indent = withGuide ? `${styleText("yellow", S_BAR)}  ` : "";
        const headerLines = headerBlock.split("\n").length;
        const errorLines = this.error
          .split("\n")
          .map((line, idx) =>
            idx === 0
              ? `${withGuide ? `${styleText("yellow", S_BAR_END)}  ` : ""}${styleText("yellow", line)}`
              : `   ${line}`,
          );
        const renderedError = errorLines.join("\n");
        const rows = limitOptions({
          output: opts.output,
          cursor: this.cursor,
          options: this.options,
          maxItems: opts.maxItems,
          columnPadding: indent.length,
          rowPadding: headerLines + renderedError.split("\n").length + 1,
          style: (option, isActive) => renderMultiselectRow(option, stateFor(option, isActive)),
        });
        return `${headerBlock}${indent}${rows.join(`\n${indent}`)}\n${renderedError}\n`;
      }
      default: {
        const indent = withGuide ? `${styleText("cyan", S_BAR)}  ` : "";
        const footer = withGuide ? styleText("cyan", S_BAR_END) : "";
        const headerLines = headerBlock.split("\n").length;
        const footerLines = withGuide ? 2 : 1;
        const rows = limitOptions({
          output: opts.output,
          cursor: this.cursor,
          options: this.options,
          maxItems: opts.maxItems,
          columnPadding: indent.length,
          rowPadding: headerLines + footerLines,
          style: (option, isActive) => renderMultiselectRow(option, stateFor(option, isActive)),
        });
        return `${headerBlock}${indent}${rows.join(`\n${indent}`)}\n${footer}\n`;
      }
    }
  };
}
