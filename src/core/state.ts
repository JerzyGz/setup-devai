import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface FsOps {
  mkdirSync: typeof mkdirSync;
  writeFileSync: typeof writeFileSync;
  renameSync: typeof renameSync;
  chmodSync: typeof chmodSync;
  readFileSync: typeof readFileSync;
}

const defaultFsOps: FsOps = { mkdirSync, writeFileSync, renameSync, chmodSync, readFileSync };
let fsOps: FsOps = defaultFsOps;

export function _setFsOpsForTesting(ops: Partial<FsOps>): void {
  fsOps = { ...defaultFsOps, ...ops };
}

const CREDENTIAL_SKIP_MESSAGE =
  "Credentials detected in URL; not saved. Configure git credentials and use a plain URL to enable autofill.";

export interface SaveLastUrlResult {
  saved: boolean;
  skippedReason?: "credentials" | "write-error";
}

/**
 * Persist `rawUrl` to the state file if it has no embedded credentials.
 *
 * - Skips (with a one-line stderr warning) when `hasCredentials(rawUrl)`
 *   is true.
 * - Skips (returning `{ saved: false, skippedReason: "write-error" }`)
 *   if the underlying `fs` calls fail — never throws.
 * - On success, writes atomically: `state.json.tmp` is created in the
 *   same directory, chmod'd to `0600`, then renamed over `state.json`.
 *   A crash mid-write leaves the previous good file intact.
 *
 * @param homeDir - Resolved value of `os.homedir()` for the current user
 * @param env - Environment to read `XDG_DATA_HOME` from
 * @param rawUrl - The URL the user successfully cloned from
 */
export function saveLastUrl(
  homeDir: string,
  env: NodeJS.ProcessEnv,
  rawUrl: string,
): SaveLastUrlResult {
  if (hasCredentials(rawUrl)) {
    process.stderr.write(`${CREDENTIAL_SKIP_MESSAGE}\n`);
    return { saved: false, skippedReason: "credentials" };
  }
  const dir = stateDir(homeDir, env);
  const target = stateFile(homeDir, env);
  const tmp = `${target}.tmp`;
  try {
    fsOps.mkdirSync(dir, { recursive: true });
    const payload = `${JSON.stringify({ lastUrl: rawUrl }, null, 2)}\n`;
    fsOps.writeFileSync(tmp, payload, { mode: 0o600 });
    fsOps.chmodSync(tmp, 0o600);
    fsOps.renameSync(tmp, target);
    return { saved: true };
  } catch {
    return { saved: false, skippedReason: "write-error" };
  }
}

/**
 * Read the last-saved URL from the state file.
 *
 * Returns `null` on any read error: missing file, malformed JSON,
 * non-object root, missing or non-string `lastUrl`, or permission
 * denied. Never throws.
 */
export function readLastUrl(homeDir: string, env: NodeJS.ProcessEnv): string | null {
  const file = stateFile(homeDir, env);
  let raw: string;
  try {
    raw = fsOps.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = (parsed as { lastUrl?: unknown }).lastUrl;
  if (typeof value !== "string") return null;
  return value;
}

/**
 * Compute the on-disk directory where the wizard's state file lives.
 *
 * The path is `${XDG_DATA_HOME:-<homeDir>/.local/share}/setup-devai`,
 * matching the XDG Base Directory specification.
 *
 * @param homeDir - Resolved value of `os.homedir()` for the current user
 * @param env - Environment to read `XDG_DATA_HOME` from
 * @returns Absolute path of the state directory
 */
export function stateDir(homeDir: string, env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homeDir, ".local", "share");
  return join(base, "setup-devai");
}

/**
 * Compute the absolute path of the state file inside the state dir.
 *
 * @param homeDir - Resolved value of `os.homedir()` for the current user
 * @param env - Environment to read `XDG_DATA_HOME` from
 * @returns Absolute path of `state.json`
 */
export function stateFile(homeDir: string, env: NodeJS.ProcessEnv): string {
  return join(stateDir(homeDir, env), "state.json");
}

/**
 * Detect whether a URL carries credentials in its userinfo component.
 *
 * The `git` credential layer is the only place we want tokens or
 * passwords to live, so any URL that already embeds them is considered
 * unsafe to persist in saved state.
 *
 * Returns `false` for:
 * - SCP-style git transport (`git@host:path`) — `new URL` rejects it
 * - `ssh://` URLs — those are the SSH transport, not a credential layer
 * - Malformed input that `new URL` cannot parse
 * - Non-HTTP(S) protocols (e.g. `file:`, `git:`)
 *
 * Returns `true` only for `http:` / `https:` URLs whose `username` or
 * `password` component is non-empty.
 */
export function hasCredentials(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return u.username.length > 0 || u.password.length > 0;
}
