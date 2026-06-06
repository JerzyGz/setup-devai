# 0002 — Hard-fail rejected registry URLs

- **Status:** Accepted
- **Date:** 2026-06-05

## Context

ADR 0001 establishes that the saved `lastUrl` field is the source of truth
for "the registry URL the user successfully cloned from," and that URLs
with embedded credentials, `file://` schemes, and other non-registry
shapes are _not_ valid values for that field.

A previous (now-removed) design treated rejection as a _soft skip_: the
wizard would print a one-line warning, leave `state.json` untouched, and
proceed with the install. This was the right call when the only
rejection trigger was embedded credentials, because `git` itself would
honor a credential helper and the user could continue working.

The bug that prompted the change: a `file:///var/folders/...` path
(a leftover temp directory) was being persisted as `lastUrl`. The next
run pre-filled that bogus path as the default in the URL prompt. The
user pressed Enter, accepting the default, and the wizard tried to
`git clone` from a temp dir that no longer existed. The error was
vague, the install aborted, and the user had no way to tell _why_ the
autofill had been poisoned.

The user's diagnosis: "I want all rejection reasons, because it helps
identify what happened."

## Decision

**Every rejection is a hard failure.** No more soft-skip.

When a URL fails validation, the wizard:

1. Writes a 3-line block to `process.stderr`:
   ```
   setup-devai: registry URL rejected
     reason: <human-readable explanation>
     url:    <the offending URL>
   ```
2. Throws a typed `RegistryUrlRejectedError` carrying `reason` and `url`.
3. The wizard's top-level catch sets `process.exitCode = 1` and returns.

The catch already exists (it was added for `git` failures). It does not
need to know about the new error type — `saveLastUrl` and
`validateRegistryUrl` are responsible for the formatted block; the
catch is responsible for the exit code.

### Rejection reason codes

| Code            | Trigger                                | Human-readable                                    |
| --------------- | -------------------------------------- | ------------------------------------------------- |
| `credentials`   | `http(s)://` with userinfo             | `URL contains embedded credentials`               |
| `file-url`      | `file://` scheme                       | `URL is a local file path, not a remote registry` |
| `malformed-url` | fails `new URL()` and is not SCP-style | `URL is malformed`                                |
| `write-error`   | fs failure (EACCES, ENOSPC, etc.)      | `Could not write state file: <os error>`          |

All four are aborts. There is no soft-skip path.

### Tightened malformed-url rule

Previously, any string that failed `new URL()` was treated as "no
credentials" and therefore savable — this was justified by SCP-style
URLs (`git@host:path`) failing the URL parser. The new rule keeps
SCP-style as savable but rejects everything else that fails
`new URL()`. The distinction: a string is savable if and only if it
either parses as a recognized registry URL scheme **or** matches the
SCP-style pattern.

### Validation runs before any I/O

`validateRegistryUrl(url)` is called by `src/index.ts` _after_ the URL
prompt returns and _before_ `git.cloneShallow`. This means:

- A bogus saved `lastUrl` (e.g. a leftover `file://` path) is caught
  before the user spends time on the rest of the wizard.
- The install never runs against a wrong-shaped URL.
- `saveLastUrl` is now a pure write; it does not validate. Validation
  is the wizard's job.

## Consequences

- A corrupted `state.json` with a non-registry URL will cause the
  wizard to abort on the next run, with a clear reason. The user
  fixes the file (or deletes it) and re-runs.
- The previous criterion 7 ("write errors do not abort the wizard")
  is **superseded** for the state-file path. Other write paths (e.g.
  install file writes) are unaffected.
- The 2-line block is the _only_ output the user sees on rejection.
  No trace, no stack — the goal is diagnosability, not debuggability.
- `hasCredentials` is no longer a public function. Its single
  responsibility is split: a private `isRegistryUrlShape(url)` does
  the scheme/format check, a private `hasUserInfo(url)` does the
  credentials check, and the public `validateRegistryUrl(url)`
  composes them.

## Reversibility

The soft-skip behavior is recoverable by catching
`RegistryUrlRejectedError` in `src/index.ts` and resuming the install
without persisting. We do not anticipate needing this.
