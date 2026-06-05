import { rmSync } from "node:fs";

export function makeCleanup(): (tempDir: string) => void {
  let cleaned = false;
  return function cleanupSync(tempDir: string): void {
    if (cleaned) return;
    cleaned = true;
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Warning: failed to clean up ${tempDir}: ${message}\n`);
    }
  };
}
