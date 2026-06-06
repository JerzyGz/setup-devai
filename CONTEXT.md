# Context

Domain glossary for `setup-devai`. Implementation lives in `src/`.

## Terms

### Registry URL

A remote git-cloneable URL identifying a registry the user wants to install
from. Valid shapes:

- `https://host/...` — plain HTTPS, no userinfo
- `http://host/...` — plain HTTP, no userinfo
- `ssh://user@host/...` — SSH transport (`user` is the transport user, not a credential)
- SCP-style `user@host:path` — bare SSH transport

**Not** a registry URL:

- `file:///path/...` — local path; not remote
- `https://user:pass@host/...` — embedded credentials
- Any input that fails `new URL()` and is not SCP-style

### `lastUrl`

The persisted field in `${stateDir}/state.json` holding the most recent
_successful_ registry URL. Its value must always be a valid registry URL —
any other shape is a rejection. The field is single-value: one URL, not a
list, not per-project.

### Rejection

The act of refusing to accept a URL. On rejection, the wizard:

1. Writes a 3-line block to `process.stderr`:
   ```
   setup-devai: registry URL rejected
     reason: <human-readable explanation>
     url:    <the offending URL>
   ```
2. Throws `RegistryUrlRejectedError` (carries `reason` and `url`).
3. The wizard's top-level catch sets `process.exitCode = 1` and returns.

Rejection reasons:

| Code            | Trigger                                | Human-readable                                    |
| --------------- | -------------------------------------- | ------------------------------------------------- |
| `credentials`   | http/https with userinfo               | `URL contains embedded credentials`               |
| `file-url`      | `file://` scheme                       | `URL is a local file path, not a remote registry` |
| `malformed-url` | fails `new URL()` and is not SCP-style | `URL is malformed`                                |
| `write-error`   | fs failure (EACCES, ENOSPC, etc.)      | `Could not write state file: <os error>`          |

All rejection reasons abort the wizard. There is no soft-skip path.

## Functions

- `validateRegistryUrl(url)` — pure validation; throws `RegistryUrlRejectedError` if invalid. Called by the wizard **before** attempting `git clone`.
- `saveLastUrl(homeDir, env, url, platform?)` — pure write of the URL to the state file. Throws `RegistryUrlRejectedError` with `reason: "write-error"` on fs failure. No validation — input is assumed pre-validated.
- `readLastUrl(homeDir, env, platform?)` — pure read; returns the URL string or `null`.

Validation is decoupled from writing. The wizard validates the URL once,
after the user submits, before any I/O happens.
