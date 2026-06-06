# 0001 — Reject credentialed URLs from saved state

- **Status:** Accepted
- **Date:** 2026-06-05

## Context

`setup-devai` prompts for a registry URL on every run. We want to remember the last successful URL and pre-fill the prompt next time, so users with a stable registry don't have to retype it (or paste from a notes file) on every invocation.

The natural place to stash a small piece of state is the user's home directory, following the XDG Base Directory spec. The constraint is that the URL is, in many real workflows, the only secret a user is willing to embed in plaintext: a private GitHub token, a self-hosted Gitea PAT, a corporate GitLab deploy key. Persisting that URL verbatim would push tokens into a `0600` file that's still readable by any process running as the user, and that's one `tar`, `rsync`, or backup upload away from leaking.

## Decision

Saved state stores only the URL — not the resolved clone, the diff, the timestamps, or anything else.

**Cross-platform path resolution:**

- **Linux**: `${XDG_DATA_HOME:-~/.local/share}/setup-devai/state.json`
- **macOS**: `${XDG_DATA_HOME:-~/Library/Application Support}/setup-devai/state.json`
- **Windows**: `${XDG_DATA_HOME:-%APPDATA%}/setup-devai/state.json`

`XDG_DATA_HOME` is honored on all platforms when set and non-empty. Platform-specific defaults apply only when `XDG_DATA_HOME` is unset or empty.

The file is written atomically (write a `state.json.tmp` sibling, `chmod 0600`, rename over the target) so a crash mid-write leaves the previous good file intact.

Before writing, we parse the URL with `new URL()` and inspect the `username` and `password` components:

- **Empty `username` and `password`** — the URL is plain (`https://github.com/org/registry.git`). Save it.
- **Non-empty `username` or `password`** — the URL carries userinfo (e.g. `https://token@host/...`). **Do not save.** Write a one-line warning to stderr and leave the existing `state.json` untouched.
- **`new URL()` rejects the input** — it is SCP-style (`git@host:path`) or otherwise unparseable. Treat as savable. The function is not policing the user's URL format; it is catching plaintext credentials embedded in the userinfo slot, and SCP-style URLs do not have one.
- **`file://` URLs** — local file paths are not valid registry URLs and are rejected (prevents temp directory paths from being saved).
- **Other non-`http(s)` protocols** (`ssh://`, `git://`) — likewise have no `http(s)` userinfo slot. Treat as savable.

This lives in `src/core/state.ts` as `hasCredentials(rawUrl)` and is the single gate that `saveLastUrl` consults before touching disk.

## Consequences

Users with a private registry behind a credentialed URL lose the autofill. They keep the full functionality of the wizard — `setup-devai` still hands the URL to `git`, which honours whatever credential helper the user has configured (`gh auth setup-git`, `git credential.helper store`, SSH keys in `~/.ssh/`, a system keychain, etc.). What they lose is the convenience of not re-typing the URL.

This is the right trade: tokens do not belong in a plaintext dotfile, and forcing the user to wire up `git`'s credential layer is the only durable way to keep them out of the saved state. The skipped-save is also a teachable moment — the stderr warning tells the user why and what to do next.

The `hasCredentials` check is intentionally narrow. SCP-style and `ssh://` URLs are _not_ "credentials in the URL" by the threat model — they're a transport, and the auth happens out-of-band (SSH agent, `~/.ssh/config`, the host's `Match` blocks). The check only fires on `http:` / `https:` URLs whose `username` or `password` is non-empty.

### Upgrade path

If we ever need to support URLs with embedded credentials, the right move is to stop storing them in `state.json` and switch to the OS keychain (`libsecret` on Linux, Keychain on macOS, Credential Manager on Windows). Plaintext state and embedded creds are a combination we are committing not to ship. We do not expect to need this — by the time a user is typing a credentialed URL, `git`'s own credential machinery is the better answer — but it is the named path off the current decision.
