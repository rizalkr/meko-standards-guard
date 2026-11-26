import { Hono } from "hono";
import { z } from "zod";
import type { PayledgerDb } from "../db/index.js";
import { requireIdempotency } from "../shared/idempotency.js";
import { ValidationError, type AppEnv } from "../shared/types.js";
import { createPayout, reversePayout } from "./service.js";

const CreatePayoutSchema = z.object({
  merchantId: z.string().trim().min(1),
  amountCents: z.number().int().positive(),
  reference: z.string().trim().min(1).optional()
});

const ReversePayoutSchema = z.object({
  reason: z.string().trim().min(1)
});

export function createPayoutsRoutes(db: PayledgerDb): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/payouts", requireIdempotency(db), async (c) => {
    const rawBody = c.get("rawBody") ?? (await c.req.text());
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      throw new ValidationError("Invalid JSON request body");
    }

    const input = CreatePayoutSchema.parse(parsedJson);
    const result = createPayout(db, input);
    return c.json(result, 201);
  });

  app.post("/payouts/:id/reverse", requireIdempotency(db), async (c) => {
    const rawBody = c.get("rawBody") ?? (await c.req.text());
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      throw new ValidationError("Invalid JSON request body");
    }

    const input = ReversePayoutSchema.parse(parsedJson);
    const result = reversePayout(db, c.req.param("id"), input.reason);
    return c.json(result, 201);
  });

  return app;
}
