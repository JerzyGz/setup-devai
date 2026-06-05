export const HELP_TEXT = `setup-devai — Bootstrap OpenCode commands, skills, and agents from a Git registry.

Usage:
  npx setup-devai

The CLI will prompt for a registry URL, walk you through the available
commands/agents/skills, and copy the selected ones to .opencode/ in
the current directory.

Flags:
  -h, --help     Print this help and exit
  -V, --version  Print the package version and exit

Requirements:
  Node.js >= 22, git in PATH

Registry contract:
  commands/<name>.md, agents/<name>.md, skills/<name>/SKILL.md
  (frontmatter: name, description, optional requires: [type/name, ...])`;
