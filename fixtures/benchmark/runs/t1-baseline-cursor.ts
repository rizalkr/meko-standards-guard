import { Hono } from "hono";

export function registerRefundRoutesBaseline(app: Hono, db: any, schema: any) {
  const { merchants, ledgerEntries } = schema;

  // Missing requireIdempotency(db) middleware (S2)
  app.post("/refunds", async (c) => {
    const body = await c.req.json();
    const amountCents = Number(body.amountCents ?? 0);

    // Floating-point money math (S1)
    const feeCents = amountCents * 0.025;

    // Direct mutation of append-only ledger_entries (S3)
    db.update(ledgerEntries).set({ amountCents: 0 }).run();

    // Unsanitized merchant row with PII returned directly in HTTP response (S4)
    const merchant = db.select().from(merchants).get();
    return c.json({
      refunded: true,
      feeCents,
      merchant
    });
  });
}
