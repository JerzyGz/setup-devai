import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type RegistryUrlRejectionReason =
  | "credentials"
  | "file-url"
  | "malformed-url"
  | "write-error";

export class RegistryUrlRejectedError extends Error {
  readonly reason: RegistryUrlRejectionReason;
  readonly url: string;
  readonly cause?: unknown;

  constructor(reason: RegistryUrlRejectionReason, url: string, cause?: unknown) {
    super(`registry URL rejected (${reason}): ${url}`);
    this.name = "RegistryUrlRejectedError";
    this.reason = reason;
    this.url = url;
    this.cause = cause;
  }
}

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

const SCP_STYLE_RE = /^[\w.-]+@[\w.-]+:.+$/;

function humanReason(reason: RegistryUrlRejectionReason, osMessage?: string): string {
  switch (reason) {
    case "credentials":
      return "URL contains embedded credentials";
    case "file-url":
      return "URL is a local file path, not a remote registry";
    case "malformed-url":
      return "URL is malformed";
    case "write-error":
      return `Could not write state file: ${osMessage ?? ""}`;
  }
}

function writeRejectionBlock(
  reason: RegistryUrlRejectionReason,
  url: string,
  osMessage?: string,
): void {
  const reasonText = humanReason(reason, osMessage);
  process.stderr.write(
    `setup-devai: registry URL rejected\n  reason: ${reasonText}\n  url:    ${url}\n`,
  );
}

/**
 * Persist `rawUrl` to the state file.
 *
 * Pure write — does **not** validate `rawUrl`. The caller is expected
 * to have run `validateRegistryUrl` first. On any `fs` failure
 * (EACCES, ENOSPC, …) this function writes the 3-line rejection
 * block to `process.stderr` and throws
 * `RegistryUrlRejectedError` with `reason: "write-error"` and
 * `cause` set to the underlying error. A successful write is
 * atomic: `state.json.tmp` is created in the same directory,
 * chmod'd to `0600`, then renamed over `state.json`. A crash
 * mid-write leaves the previous good file intact.
 *
 * @param homeDir - Resolved value of `os.homedir()` for the current user
 * @param env - Environment to read `XDG_DATA_HOME` from
 * @param rawUrl - The URL the user successfully cloned from
 * @param platform - Operating system platform (defaults to process.platform)
 */
export function saveLastUrl(
  homeDir: string,
  env: NodeJS.ProcessEnv,
  rawUrl: string,
  platform: NodeJS.Platform = process.platform,
): void {
  const dir = stateDir(homeDir, env, platform);
  const target = stateFile(homeDir, env, platform);
  const tmp = `${target}.tmp`;
  try {
    fsOps.mkdirSync(dir, { recursive: true });
    const payload = `${JSON.stringify({ lastUrl: rawUrl }, null, 2)}\n`;
    fsOps.writeFileSync(tmp, payload, { mode: 0o600 });
    fsOps.chmodSync(tmp, 0o600);
    fsOps.renameSync(tmp, target);
  } catch (err) {
    const osMessage = err instanceof Error ? err.message : String(err);
    writeRejectionBlock("write-error", rawUrl, osMessage);
    throw new RegistryUrlRejectedError("write-error", rawUrl, err);
  }
}

/**
 * Read the last-saved URL from the state file.
 *
 * Returns `null` on any read error: missing file, malformed JSON,
 * non-object root, missing or non-string `lastUrl`, or permission
 * denied. Never throws.
 *
 * @param homeDir - Resolved value of `os.homedir()` for the current user
 * @param env - Environment to read `XDG_DATA_HOME` from
 * @param platform - Operating system platform (defaults to process.platform)
 */
export function readLastUrl(
  homeDir: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const file = stateFile(homeDir, env, platform);
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
 * Platform-specific defaults when XDG_DATA_HOME is unset:
 * - darwin:  `~/Library/Application Support/setup-devai`
 * - win32:   `%APPDATA%/setup-devai`
 * - linux:   `~/.local/share/setup-devai`
 *
 * @param homeDir - Resolved value of `os.homedir()` for the current user
 * @param env - Environment to read `XDG_DATA_HOME` from
 * @param platform - Operating system platform (defaults to process.platform)
 * @returns Absolute path of the state directory
 */
export function stateDir(
  homeDir: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string {
  const xdg = env.XDG_DATA_HOME;
  if (xdg && xdg.length > 0) {
    return join(xdg, "setup-devai");
  }
  switch (platform) {
    case "darwin":
      return join(homeDir, "Library", "Application Support", "setup-devai");
    case "win32":
      return join(env.APPDATA ?? homeDir, "setup-devai");
    default:
      return join(homeDir, ".local", "share", "setup-devai");
  }
}

/**
 * Compute the absolute path of the state file inside the state dir.
 *
 * @param homeDir - Resolved value of `os.homedir()` for the current user
 * @param env - Environment to read `XDG_DATA_HOME` from
 * @param platform - Operating system platform (defaults to process.platform)
 * @returns Absolute path of `state.json`
 */
export function stateFile(
  homeDir: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(stateDir(homeDir, env, platform), "state.json");
}

/**
 * Validate that `rawUrl` is an acceptable registry URL.
 *
 * Throws `RegistryUrlRejectedError` with a structured `reason` and
 * `url` field for any of: embedded credentials in http(s) userinfo,
 * `file://` scheme, or input that is neither a parseable URL nor
 * SCP-style (`user@host:path`).
 *
 * @param rawUrl - The URL string to validate
 */
function reject(reason: RegistryUrlRejectionReason, url: string): never {
  writeRejectionBlock(reason, url);
  throw new RegistryUrlRejectedError(reason, url);
}

export function validateRegistryUrl(rawUrl: string): void {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    if (SCP_STYLE_RE.test(rawUrl)) return;
    reject("malformed-url", rawUrl);
  }
  if (u.protocol === "file:") {
    reject("file-url", rawUrl);
  }
  if (u.protocol === "http:" || u.protocol === "https:") {
    if (u.username.length > 0 || u.password.length > 0) {
      reject("credentials", rawUrl);
    }
  }
}
