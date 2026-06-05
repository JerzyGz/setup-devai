import * as clack from "@clack/prompts";

const REGISTRY_URL_PLACEHOLDER = "https://github.com/you/your-registry";

export interface UrlPromptDeps {
  text: (opts: { message: string; placeholder?: string }) => Promise<string | symbol>;
  isCancel: (value: unknown) => value is symbol;
}

const defaultDeps: UrlPromptDeps = {
  text: clack.text,
  isCancel: clack.isCancel,
};

export async function url(deps: UrlPromptDeps = defaultDeps): Promise<string> {
  for (;;) {
    const value = await deps.text({
      message: "Registry URL",
      placeholder: REGISTRY_URL_PLACEHOLDER,
    });
    if (deps.isCancel(value)) {
      throw new Error("User cancelled");
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
}
