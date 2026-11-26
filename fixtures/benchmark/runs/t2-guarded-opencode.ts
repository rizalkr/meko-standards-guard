import { Hono } from "hono";

export function registerInstantPayoutGuarded(
  app: Hono<any>,
  db: any,
  deps: {
    requireIdempotency: (db: any) => any;
    assertPositiveCents: (value: number, label: string) => void;
    getMerchantBalanceCents: (executor: any, merchantId: string) => number;
    postBalancedEntries: (executor: any, params: any) => any;
  }
) {
  const { requireIdempotency, assertPositiveCents, getMerchantBalanceCents, postBalancedEntries } =
    deps;

  app.post("/payouts/instant", requireIdempotency(db), async (c) => {
    const rawBody = c.get("rawBody") ?? (await c.req.text());
    const body = JSON.parse(rawBody) as { merchantId: string; amountCents: number };
    assertPositiveCents(body.amountCents, "amountCents");

    const payout = db.transaction(
      (tx: any) => {
        const availableCents = getMerchantBalanceCents(tx, body.merchantId);
        if (body.amountCents > availableCents) {
          throw new Error("Insufficient balance");
        }
        return postBalancedEntries(tx, {
          merchantId: body.merchantId,
          entryType: "PAYOUT_SETTLEMENT",
          referenceId: "instant-payout",
          lines: []
        });
      },
      { behavior: "immediate" }
    );

    return c.json({ txGroupId: payout.txGroupId }, 201);
  });
}
