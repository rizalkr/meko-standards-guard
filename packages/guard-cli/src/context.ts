import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  GuardModeSchema,
  createMekoClient,
  loadGuardConfig,
  type GuardConfig,
  type GuardMode,
  type MekoClient
} from "@meko-guard/core";

export interface CliContextOptions {
  rootDir?: string;
  mode?: GuardMode;
  fixturePath?: string;
}

export interface GuardClientContext {
  rootDir: string;
  config: GuardConfig;
  mode: GuardMode;
  meko: MekoClient;
}

/**
 * Resolves the execution mode from CLI flags, environment variables, or the default offline mock mode.
 */
export function resolveMode(rawMode?: string): GuardMode {
  return GuardModeSchema.parse(rawMode ?? process.env.GUARD_MODE ?? "mock");
}

/**
 * Returns repository-relative paths of currently staged files (added, copied, modified, renamed).
 */
export function resolveGitStagedFiles(rootDir: string): string[] {
  try {
    const out = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
      {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }
    );
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Returns the short HEAD commit SHA for provenance metadata, or "unknown" outside a git repository.
 */
export function resolveGitHead(rootDir: string): string {
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return out.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Loads KEY=VALUE pairs from <rootDir>/.env into process.env when not already set.
 */
function loadDotEnvIfPresent(rootDir: string): void {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const raw = fs.readFileSync(envPath, "utf8");
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let val = line.slice(eqIndex + 1).trim();
    if (
      (val.startsWith("\"") && val.endsWith("\"") && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

/**
 * Opens a configured MekoClient, executes the callback, and ensures persistence/disconnect on exit.
 */
export async function withMekoClient<T>(
  options: CliContextOptions,
  fn: (ctx: GuardClientContext) => Promise<T>
): Promise<T> {
  const rootDir = options.rootDir ?? process.cwd();
  loadDotEnvIfPresent(rootDir);
  const mode = resolveMode(options.mode);
  const config = loadGuardConfig(rootDir);
  const fixturePath = options.fixturePath
    ? path.resolve(rootDir, options.fixturePath)
    : path.resolve(rootDir, config.fixturePath);
  const stateFilePath =
    mode === "mock" ? undefined : path.join(rootDir, ".guard-state", "live-events.json");

  const meko = createMekoClient({
    mode,
    datapack: config.datapack,
    fixturePath,
    stateFilePath
  });

  await meko.connect();
  try {
    return await fn({ rootDir, config, mode, meko });
  } finally {
    await meko.close();
  }
}
