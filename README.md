# setup-devai

`npx`-run CLI that bootstraps an OpenCode project's commands, agents, and skills from a Git-hosted registry.

## What it does

`setup-devai` walks you through a 2-level interactive wizard:

1. Pick an element type (commands, agents, or skills).
2. Multi-select the items you want to install, then choose `Install`.

It shallow-clones a registry, parses the frontmatter of every element, lets you resolve collisions with existing files in your project, and copies the selected items into `.opencode/`. After install, it prints a summary of installed / skipped / failed counts.

## Quick start

```sh
npx setup-devai
```

You'll be prompted for the registry Git URL, then driven through the wizard.

## Registry contract

A registry is a Git repository laid out as:

```
commands/<name>.md
agents/<name>.md
skills/<name>/SKILL.md
```

Each element file is Markdown with YAML frontmatter:

```yaml
---
name: my-thing
description: One-line description shown in the picker.
requires:
  - command/build
  - skill/lint
---
```

`name` and `description` are required. `requires` is optional and lists other elements (as `type/name`) that must also be selected for the item to install cleanly.

Install target is `<CWD>/.opencode/{command,agent,skill}/...`. The CLI creates the directories as needed.

## Flags

| Flag              | Description                |
| ----------------- | -------------------------- |
| `--help`, `-h`    | Show help and exit.        |
| `--version`, `-V` | Show the version and exit. |

## Requirements

- Node.js `>=22.0.0`
- `git` on `PATH` (for shallow-cloning the registry)

## License

MIT — Copyright (c) 2026 JerzyGz
