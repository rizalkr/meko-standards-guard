import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { resolveMode } from "@meko-guard/cli";
import { createGovernanceApp } from "./app.js";

interface ParsedArgs {
  port: number;
  host: string;
  mode?: string;
  fixture?: string;
  root?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    port: Number(process.env.GUARD_UI_PORT ?? 4321),
    host: process.env.GUARD_UI_HOST ?? "127.0.0.1"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--port" || arg === "-p") && next) {
      parsed.port = Number(next);
      i += 1;
    } else if (arg === "--host" && next) {
      parsed.host = next;
      i += 1;
    } else if (arg === "--mode" && next) {
      parsed.mode = next;
      i += 1;
    } else if (arg === "--fixture" && next) {
      parsed.fixture = next;
      i += 1;
    } else if (arg === "--root" && next) {
      parsed.root = next;
      i += 1;
    }
  }

  if (!Number.isInteger(parsed.port) || parsed.port <= 0 || parsed.port > 65535) {
    throw new Error(`Invalid port number: ${parsed.port}`);
  }
  return parsed;
}

function findWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, "guard.config.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function resolveStaticDir(rootDir: string): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../client"),
    path.resolve(rootDir, "packages/guard-ui/dist/client")
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, "index.html")));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = args.root ? path.resolve(args.root) : findWorkspaceRoot(process.cwd());
  const mode = resolveMode(args.mode);
  const staticDir = resolveStaticDir(rootDir);

  const app = createGovernanceApp({
    rootDir,
    mode,
    fixturePath: args.fixture,
    staticDir
  });

  serve(
    {
      fetch: app.fetch,
      port: args.port,
      hostname: args.host
    },
    (info) => {
      console.log(
        `[guard-ui] Governance Control Plane running at http://${args.host}:${info.port} (mode=${mode}, root=${rootDir})`
      );
      if (!staticDir) {
        console.log(
          "[guard-ui] Static dist/client not found; serving /api routes only (use Vite dev server or run npm run build -w @meko-guard/ui)."
        );
      }
    }
  );
}

main();
