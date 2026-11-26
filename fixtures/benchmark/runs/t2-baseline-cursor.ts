import { Hono } from "hono";

export function registerInstantPayoutBaseline(
  app: Hono,
  db: any,
  deps: {
    ledgerEntries: any;
    getMerchantBalanceCents: (executor: any, merchantId: string) => number;
    postBalancedEntries: (executor: any, params: any) => any;
  }
) {
  const { ledgerEntries, getMerchantBalanceCents, postBalancedEntries } = deps;

  // Missing requireIdempotency(db) middleware (S2)
  app.post("/payouts/instant", async (c) => {
    const body = (await c.req.json()) as { merchantId: string; amountCents: number };

    // Balance check and ledger write outside immediate db.transaction (S5)
    const available = getMerchantBalanceCents(db, body.merchantId);
    if (body.amountCents > available) {
      return c.json({ error: "Insufficient balance" }, 409);
    }

    const posted = postBalancedEntries(db, {
      merchantId: body.merchantId,
      entryType: "PAYOUT_SETTLEMENT",
      referenceId: "instant-payout",
      lines: []
    });

    // Forbidden delete on append-only ledger_entries (S3)
    db.delete(ledgerEntries).run();

    return c.json({ payoutId: posted.txGroupId }, 201);
  });
}
