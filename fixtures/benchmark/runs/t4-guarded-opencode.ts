import { Hono } from "hono";

export function registerStripeRetryGuarded(
  app: Hono,
  deps: {
    webhookSecret: string;
    verifyWebhookSignature: (params: {
      rawBody: string;
      signatureHeader: string | undefined;
      timestampHeader: string | undefined;
      secret: string;
    }) => { valid: boolean; reason?: string };
  }
) {
  app.post("/webhooks/stripe-retry", async (c) => {
    const rawBody = await c.req.text();
    const verified = deps.verifyWebhookSignature({
      rawBody,
      signatureHeader: c.req.header("X-Signature"),
      timestampHeader: c.req.header("X-Timestamp"),
      secret: deps.webhookSecret
    });

    if (!verified.valid) {
      console.warn({ event: "webhook_rejected", reason: verified.reason ?? "invalid_signature" });
      return c.json({ error: "Invalid webhook signature" }, 401);
    }

    const payload = JSON.parse(rawBody) as { id: string; type: string };
    return c.json({ accepted: true, eventId: payload.id }, 200);
  });
}
