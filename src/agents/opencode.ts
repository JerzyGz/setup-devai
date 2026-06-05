import type { AgentProfile } from "../types.js";

export const opencode: AgentProfile = {
  id: "opencode",
  displayName: "OpenCode",
  registry: {
    commandDir: "commands",
    agentDir: "agents",
    skillDir: "skills",
  },
  install: {
    baseDir: ".opencode",
    commandSubdir: "command",
    agentSubdir: "agent",
    skillSubdir: "skill",
  },
  labels: {
    command: "Commands",
    agent: "Agents / Subagents",
    skill: "Skills",
  },
};
