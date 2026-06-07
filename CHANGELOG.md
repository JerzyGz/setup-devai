# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-06-07

### Fixed
- Symlinked installs (e.g. `npm link`) now correctly invoke `main()` when the entry script is resolved through a symlink.

### Documentation
- README now shows the actual pluralized install paths (`.opencode/commands/`, `.opencode/agents/`, `.opencode/skills/`) instead of the singular forms.

### Internal
- Release workflow now gates `pnpm publish` on a version-change check against the previous tag, preventing redundant publishes on tag re-pushes.
- Release workflow switched to OIDC-based npm provenance; the manual `NPM_TOKEN` secret is no longer required.
