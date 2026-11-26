import { Hono } from "hono";
import { eq } from "drizzle-orm";

export function registerRefundRoutesGuarded(
  app: Hono<any>,
  db: any,
  deps: {
    requireIdempotency: (db: any) => any;
    multiplyBpsBankers: (amountCents: number, bps: number) => number;
    assertSafeCents: (value: number, label: string) => void;
    reverseLedgerGroup: (tx: any, txGroupId: string, reason: string) => any;
    toPublicMerchantDto: (merchant: any) => any;
    merchants: any;
  }
) {
  const {
    requireIdempotency,
    multiplyBpsBankers,
    assertSafeCents,
    reverseLedgerGroup,
    toPublicMerchantDto,
    merchants
  } = deps;

  app.post("/refunds", requireIdempotency(db), async (c) => {
    const rawBody = c.get("rawBody") ?? (await c.req.text());
    const body = JSON.parse(rawBody) as {
      merchantId: string;
      txGroupId: string;
      amountCents: number;
      reason: string;
    };

    assertSafeCents(body.amountCents, "amountCents");

    const result = db.transaction(
      (tx: any) => {
        const merchant = tx
          .select({
            id: merchants.id,
            name: merchants.name,
            email: merchants.email,
            feeBps: merchants.feeBps,
            taxRateBps: merchants.taxRateBps,
            createdAt: merchants.createdAt
          })
          .from(merchants)
          .where(eq(merchants.id, body.merchantId))
          .get();

        const refundFeeCents = multiplyBpsBankers(body.amountCents, merchant.feeBps);
        const reversal = reverseLedgerGroup(tx, body.txGroupId, body.reason);

        return {
          refundFeeCents,
          reversalTxGroupId: reversal.reversalTxGroupId,
          merchant: toPublicMerchantDto(merchant)
        };
      },
      { behavior: "immediate" }
    );

    return c.json(result, 201);
  });
}
