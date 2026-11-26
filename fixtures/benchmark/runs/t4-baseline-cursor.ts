import { Hono } from "hono";

export function registerStripeRetryBaseline(app: Hono) {
  app.post("/webhooks/stripe-retry", async (c) => {
    // Calls c.req.json() before HMAC signature verification (S6)
    const payload = (await c.req.json()) as {
      id: string;
      bankAccountNumber?: string;
    };

    // Logs sensitive financial PII field directly (S4)
    console.error({
      event: "webhook_retry_error",
      bankAccountNumber: payload.bankAccountNumber
    });

    return c.json({ accepted: true, eventId: payload.id }, 200);
  });
}
