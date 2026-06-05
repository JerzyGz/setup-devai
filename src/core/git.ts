import { spawn, spawnSync, type ChildProcess } from "node:child_process";

export function commandExists(cmd: string): boolean {
  const result = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

export function cloneShallow(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn("git", ["clone", "--depth", "1", url, dest], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail =
        stderr
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .pop() ?? "unknown error";
      reject(new Error(`git clone failed: ${detail}`));
    });
  });
}
