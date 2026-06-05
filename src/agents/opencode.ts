import type { AgentProfile } from "../types.js";

export const OpenCodeFolders = {
  skills: "skills",
  commands: "commands",
  agents: "agents",
} as const;

export const opencode: AgentProfile = {
  id: "opencode",
  displayName: "OpenCode",
  registry: {
    commandDir: OpenCodeFolders.commands,
    agentDir: OpenCodeFolders.agents,
    skillDir: OpenCodeFolders.skills,
  },
  install: {
    baseDir: ".opencode",
    commandSubdir: OpenCodeFolders.commands,
    agentSubdir: OpenCodeFolders.agents,
    skillSubdir: OpenCodeFolders.skills,
  },
  labels: {
    command: "Commands",
    agent: "Agents / Subagents",
    skill: "Skills",
  },
};
