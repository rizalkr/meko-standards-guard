import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { PayledgerDb } from "../db/index.js";
import { invoices, webhookEvents } from "../db/schema.js";
import { captureInvoiceInTx } from "../invoices/service.js";
import { ValidationError, type AppEnv } from "../shared/types.js";
import { verifyWebhookSignature } from "./signature.js";

const WebhookPayloadSchema = z.object({
  eventId: z.string().trim().min(1),
  type: z.literal("invoice.paid"),
  data: z.object({
    invoiceId: z.string().trim().min(1)
  })
});

export interface WebhooksRoutesOptions {
  webhookSecret: string;
  nowSeconds?: () => number;
  logger?: (entry: { event: string; reason: string }) => void;
}

export function createWebhooksRoutes(
  db: PayledgerDb,
  options: WebhooksRoutesOptions
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const log =
    options.logger ??
    ((entry: { event: string; reason: string }) => {
      console.warn(JSON.stringify(entry));
    });

  app.post("/webhooks/payments", async (c) => {
    const rawBody = await c.req.text();
    const verification = verifyWebhookSignature({
      rawBody,
      signatureHeader: c.req.header("X-Signature"),
      timestampHeader: c.req.header("X-Timestamp"),
      secret: options.webhookSecret,
      nowSeconds: options.nowSeconds ? options.nowSeconds() : undefined
    });

    if (!verification.valid) {
      log({ event: "webhook_rejected", reason: verification.reason });
      return c.json({ error: "Invalid webhook signature", code: "INVALID_WEBHOOK_SIGNATURE" }, 401);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      throw new ValidationError("Invalid JSON webhook payload");
    }

    const payload = WebhookPayloadSchema.parse(parsedJson);

    const outcome = db.transaction(
      (tx) => {
        const existingEvent = tx
          .select()
          .from(webhookEvents)
          .where(eq(webhookEvents.eventId, payload.eventId))
          .get();

        if (existingEvent) {
          return { received: true, duplicate: true, invoiceId: payload.data.invoiceId };
        }

        const invoiceRow = tx
          .select({ status: invoices.status })
          .from(invoices)
          .where(eq(invoices.id, payload.data.invoiceId))
          .get();

        if (invoiceRow?.status !== "PAID") {
          captureInvoiceInTx(tx, payload.data.invoiceId);
        }

        tx.insert(webhookEvents)
          .values({
            eventId: payload.eventId,
            eventType: payload.type,
            receivedAt: new Date().toISOString()
          })
          .run();

        return { received: true, duplicate: false, invoiceId: payload.data.invoiceId };
      },
      { behavior: "immediate" }
    );

    return c.json(outcome, 200);
  });

  return app;
}
