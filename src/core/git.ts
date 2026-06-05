import { spawnSync } from "node:child_process";

export function commandExists(cmd: string): boolean {
  const result = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}
