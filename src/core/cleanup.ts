import { rmSync } from "node:fs";

/**
 * Create an idempotent cleanup function for a temp directory.
 *
 * The returned function will only attempt to remove the directory once
 * (no matter how many times it is invoked), and swallows errors with
 * a stderr warning so that cleanup never masks a more important error.
 */
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
