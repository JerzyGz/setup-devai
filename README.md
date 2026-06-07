# setup-devai

An interactive CLI that installs OpenCode commands, agents, and skills from a Git registry into your project.

## What it does

`setup-devai` walks you through a short wizard:

1. Pick what you want to install — commands, agents, or skills.
2. Choose the items you want, then press **Install**.

It downloads the registry, reads each item, and checks it against your project. If a file already exists, you decide what to do with it. The selected items are copied into `.opencode/`. When it's done, you get a short summary of what was installed, skipped, or failed.

## Quick start

```sh
npx setup-devai@latest
```

You'll be asked for the registry's Git URL, then the wizard takes over.

## Registry contract

A registry is a Git repository laid out as:

```
commands/<name>.md
agents/<name>.md
skills/<name>/SKILL.md
```

Each file is Markdown with a small YAML header at the top:

```yaml
---
name: my-thing
description: One-line description shown in the picker.
requires:
  - command/build
  - skill/lint
---
```

`name` and `description` are required.

`requires` is optional. Use it to list other items (as `type/name`) that should be installed alongside this one for it to work.

Selected items are copied into `.opencode/commands/`, `.opencode/agents/`, or `.opencode/skills/` inside the folder where you ran the command. Any missing folders are created for you.

## Flags

| Flag              | Description                |
| ----------------- | -------------------------- |
| `--help`, `-h`    | Show help and exit.        |
| `--version`, `-V` | Show the version and exit. |

## Saved state

To skip typing the registry URL every time, the last URL you used is saved to:

```
${XDG_DATA_HOME:-~/.local/share}/setup-devai/state.json
```

The file is written safely (to a temp file first, then renamed into place). It stores a single value — the last URL — and that value pre-fills the URL prompt on your next run.

**Credentials in the URL are never saved.**

If a URL contains a username or password — for example `https://token@host/...` — the wizard ignores it and prints a warning. Only plain URLs (such as `https://...`, `ssh://...`, or `git@host:...`) are remembered.

**For private registries**, make sure you're already authenticated before you start. Either sign in with `gh auth login` or set up an SSH key. The CLI uses git's existing authentication — it does not read credentials from the URL.

## Requirements

- Node.js `>=22.0.0`
- `git` on `PATH` (used to download the registry)

## License

MIT — Copyright (c) 2026 JerzyGz
