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

## Saved state

To skip re-typing the registry URL on every run, the last successful URL is written to:

```
${XDG_DATA_HOME:-~/.local/share}/setup-devai/state.json
```

The file is created atomically (write a `.tmp` sibling, `chmod 0600`, rename over the target) and stores a single JSON object: `{ "lastUrl": "..." }`. On the next run, that value pre-fills the URL prompt.

**Credentialed URLs are never persisted.** A URL whose `new URL()` parse has a non-empty `username` or `password` — i.e. `https://token@host/...` — is skipped with a one-line stderr warning, leaving the previous `state.json` untouched. SCP-style (`git@host:path`) and `ssh://` transports remain savable: they carry no `http(s)` userinfo, and any auth happens out-of-band via SSH.

For private registries, configure a credential helper instead of embedding a token in the URL: `gh auth setup-git`, SSH keys in `~/.ssh/`, or a `git credential.helper` entry.

## Pre-check of already-installed items

When you open the multi-select picker for a type, the wizard compares the freshly-cloned registry against your project's `.opencode/` directory and labels each item according to one of three states:

| Local state                              | Pre-checked on first visit | Label suffix              | Install behavior                      |
| ---------------------------------------- | -------------------------- | ------------------------- | ------------------------------------- |
| Not installed                            | No                         | —                         | Normal install                        |
| Installed, byte-for-byte identical       | Yes                        | —                         | Skipped silently                      |
| Installed, content differs from registry | No                         | `(new version available)` | Normal collision flow if you check it |

The comparison is live, against the freshly-cloned registry and the files on disk — no install manifest, lockfile, or hidden dotfile is written. (See `docs/adr/0002-no-install-manifest.md` for why.)

- **Commands and agents** are compared byte-for-byte against the corresponding `.md` file under `.opencode/commands/` or `.opencode/agents/`.
- **Skills** are compared as recursive directory walks. The walk skips `.DS_Store`, `Thumbs.db`, `.gitignore`, and any `.git/` directory on either side, so platform noise (Finder metadata, Windows thumbnails) never causes a spurious "new version available" marker. Permissions, timestamps, and symlink targets are not part of the comparison.
- A skill whose only difference is a `.DS_Store` (or any of the ignored noise files) is reported as **identical** and skipped silently.

Items in the `differs` state get the `(new version available)` suffix appended to their label only — the hint (description) is unaffected, and the single-line hint cropping still applies to the hint. On install, `differs` items trigger the normal collision prompt; `identical` items bypass the prompt and produce a `skipped` result with reason `already-installed`. The post-install summary breaks the skipped count down by reason, e.g. `Skipped 3 (2 already installed, 1 collisions declined)`.

After the user un-checks a pre-checked item and switches to another type, returning to the original type keeps the item un-checked — the per-type picker remembers the user's last word, distinguishing "never visited this type this session" from "visited and confirmed empty".

## Requirements

- Node.js `>=22.0.0`
- `git` on `PATH` (for shallow-cloning the registry)

## License

MIT — Copyright (c) 2026 JerzyGz
