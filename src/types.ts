export type ElementType = "command" | "agent" | "skill";

export interface Frontmatter {
  name: string;
  description: string;
  requires: string[];
}

export interface Item {
  id: string;
  type: ElementType;
  name: string;
  description: string;
  path: string;
  isDirectory: boolean;
  frontmatter: Frontmatter;
}

export interface AgentProfile {
  id: string;
  displayName: string;
  registry: {
    commandDir: "commands";
    agentDir: "agents";
    skillDir: "skills";
  };
  install: {
    baseDir: string;
    commandSubdir: string;
    agentSubdir: string;
    skillSubdir: string;
  };
  labels: {
    command: string;
    agent: string;
    skill: string;
  };
}
