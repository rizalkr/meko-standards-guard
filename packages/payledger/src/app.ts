import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { createAccountsRoutes } from "./accounts/routes.js";
import type { PayledgerDb } from "./db/index.js";
import { createInvoicesRoutes } from "./invoices/routes.js";
import { createPayoutsRoutes } from "./payouts/routes.js";
import { AppError, type AppEnv } from "./shared/types.js";
import { createWebhooksRoutes } from "./webhooks/routes.js";

export interface CreatePayledgerAppOptions {
  db: PayledgerDb;
  webhookSecret: string;
  nowSeconds?: () => number;
  webhookLogger?: (entry: { event: string; reason: string }) => void;
}

export function createPayledgerApp(options: CreatePayledgerAppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: err.message, code: err.code },
        err.statusCode as ContentfulStatusCode
      );
    }

    if (err instanceof ZodError) {
      return c.json(
        {
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          issues: err.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        },
        400
      );
    }

    return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  });

  app.get("/health", (c) => c.json({ status: "ok", service: "payledger" }, 200));

  app.route("/", createAccountsRoutes(options.db));
  app.route("/", createInvoicesRoutes(options.db));
  app.route("/", createPayoutsRoutes(options.db));
  app.route(
    "/",
    createWebhooksRoutes(options.db, {
      webhookSecret: options.webhookSecret,
      nowSeconds: options.nowSeconds,
      logger: options.webhookLogger
    })
  );

  return app;
}
