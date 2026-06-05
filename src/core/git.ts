import { spawn, spawnSync, type ChildProcess } from "node:child_process";

/**
 * Check whether a command is available in the current PATH.
 *
 * Runs `cmd --version` and treats exit code 0 as proof of availability.
 *
 * @param cmd - The executable name to check (e.g. "git")
 * @returns true if the command exists and runs successfully
 */
export function commandExists(cmd: string): boolean {
  const result = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

/**
 * Shallow-clone a Git repository into `dest`.
 *
 * Uses `git clone --depth 1` for speed (we only need HEAD).
 * The non-zero exit branch surfaces the last non-empty line of stderr
 * so error messages are concise and useful.
 *
 * @param url - The repository URL to clone
 * @param dest - Local destination path
 * @returns Resolves on successful clone, rejects with a descriptive error otherwise
 */
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
