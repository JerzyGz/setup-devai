# 0002 — No install manifest

- **Status:** Accepted
- **Date:** 2026-06-05

## Context

`setup-devai` copies commands, agents, and skills from a freshly-cloned registry into the user's project. We want to give the user a good experience on re-runs: items that are already on disk and still match the registry byte-for-byte should be pre-checked in the picker, and re-installing them should be a silent no-op rather than a noisy collision prompt. Items that are on disk but no longer match the registry (because the user edited them locally, or the registry has moved on) should be flagged so the user can decide.

The natural mechanism for that is some form of state — a manifest, a lockfile, a `.opencode/.setup-devai.json` — that records "this is what we last installed, with these hashes." With that, the picker can compare installed-on-disk to registry in a single read and know the answer. The cost is one more file under `.opencode/` (or `~/.local/share/`, or somewhere else) and one more thing to keep correct, version, and document.

The alternative is to skip the manifest entirely and re-derive the answer on every run by walking the freshly-cloned registry and the user's `.opencode/` directly. That trades a per-run filesystem walk (cheap) for not having to maintain a manifest (significant), and it forces the comparison to be live rather than against a recorded snapshot.

The picker has to distinguish "never visited this type this session" from "visited and un-checked everything." That distinction is purely in-memory, not on disk.

## Decision

We deliberately do **not** record an install manifest, lockfile, snapshot, or any other on-disk state for the purposes of this feature. The wizard's pre-check is always a live comparison between the freshly-cloned registry and the current contents of the user's `.opencode/` directory:

- **Commands and agents** are single `.md` files; they are compared byte-for-byte.
- **Skills** are directories; they are compared as recursive walks that skip `.DS_Store`, `Thumbs.db`, `.gitignore`, and `.git/` on both sides.
- Permissions, timestamps, and symlink targets are deliberately not part of the comparison.

The picker state is also in-memory only: a `Map<ElementType, Item[]>` in `src/index.ts` records the user's most-recent picks for each type during the current session, and is dropped on process exit.

The single piece of state the wizard does persist is the last-successful registry URL (see ADR 0001). That state is small, low-risk, and is keyed to the URL, not to the installed files.

## Consequences

The wizard cannot tell the difference between "the user edited this file locally" and "the registry changed since the last install." Both surface as the same `(new version available)` marker on the label, and both fall through to the normal collision prompt if the user re-selects them. A user who wants to know which side of that distinction they are on has to `diff` the file themselves.

That is the deliberate trade. The cost of the ambiguity is small: the collision prompt is the right place to ask "do you want to overwrite this?", and the user can answer based on what they see. The cost of maintaining a manifest — keeping it in sync across renames, deletions, manual edits, partial clones, and registry moves; documenting it; migrating it on schema changes; and explaining to users how to repair it when it goes wrong — is large. The manifest would have to be a writeable file in `.opencode/`, which means we are now responsible for cleanup on uninstall, for what to do when the user edits it by hand, and for what shows up in their `git status`. None of those are problems we need to have.

The "live comparison" is also robust to the user deleting a file by hand, reverting a change with `git checkout`, or running `setup-devai` from a different shell after the registry has moved on. The next run simply re-derives the truth.

The cost is one filesystem walk per picker visit, per skill: `readdirSync` on each side, then `readFileSync` per common path, byte-compare. For a registry with a handful of skills and a few hundred KB of total content, this is well under 10ms per skill. Even a slow disk is not the bottleneck.

### Upgrade path

If attribution ever becomes worth the cost — that is, if users routinely want to know "did the registry change, or did I?" — the right move is to introduce a real install manifest:

- Store it as `.opencode/.setup-devai.json` (a hidden file inside the install root, so it travels with the project and shows up in `git status` if the user wants to commit it).
- Record the registry URL, the registry commit SHA, the per-item hash, and the install timestamp.
- Make the manifest optional: if it's missing or malformed, fall back to the live comparison — never block the user on a corrupt state file.
- Use the same `computeTarget` mapping that the live comparison uses, so the two cannot drift.

We do not expect to need this. The current UX is "label with `(new version available)`, let the user open `git diff` if they care," and that has been enough in practice. But the named upgrade path is there if attribution becomes important.
