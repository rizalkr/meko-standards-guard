import { Hono } from "hono";
import { z } from "zod";
import type { PayledgerDb } from "../db/index.js";
import { requireIdempotency } from "../shared/idempotency.js";
import { ValidationError, type AppEnv } from "../shared/types.js";
import { captureInvoice, createInvoice, getInvoiceById } from "./service.js";

const CreateInvoiceSchema = z.object({
  merchantId: z.string().trim().min(1),
  currency: z.string().trim().length(3).optional(),
  lineItems: z
    .array(
      z.object({
        description: z.string().trim().min(1),
        quantity: z.number().int().positive(),
        unitAmountCents: z.number().int().positive()
      })
    )
    .min(1)
});

export function createInvoicesRoutes(db: PayledgerDb): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/invoices", requireIdempotency(db), async (c) => {
    const rawBody = c.get("rawBody") ?? (await c.req.text());
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      throw new ValidationError("Invalid JSON request body");
    }

    const input = CreateInvoiceSchema.parse(parsedJson);
    const invoice = createInvoice(db, input);
    return c.json({ invoice }, 201);
  });

  app.get("/invoices/:id", (c) => {
    const invoice = getInvoiceById(db, c.req.param("id"));
    return c.json({ invoice }, 200);
  });

  app.post("/invoices/:id/capture", requireIdempotency(db), (c) => {
    const result = captureInvoice(db, c.req.param("id"));
    return c.json(result, 200);
  });

  return app;
}
