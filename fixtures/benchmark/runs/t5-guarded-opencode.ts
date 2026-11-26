import { Hono } from "hono";
import { eq } from "drizzle-orm";

export function registerRateUpdateGuarded(
  app: Hono,
  db: any,
  deps: {
    merchants: any;
    toPublicMerchantDto: (merchant: any) => any;
  }
) {
  const { merchants, toPublicMerchantDto } = deps;

  app.patch("/merchants/:id/rates", async (c) => {
    const merchantId = c.req.param("id");
    const body = (await c.req.json()) as { feeBps: number; taxRateBps: number };

    if (!Number.isSafeInteger(body.feeBps) || !Number.isSafeInteger(body.taxRateBps)) {
      return c.json({ error: "Basis points must be safe integers" }, 400);
    }

    const updated = db.transaction(
      (tx: any) => {
        tx.update(merchants)
          .set({ feeBps: body.feeBps, taxRateBps: body.taxRateBps })
          .where(eq(merchants.id, merchantId))
          .run();
        return tx.select().from(merchants).where(eq(merchants.id, merchantId)).get();
      },
      { behavior: "immediate" }
    );

    return c.json({ merchant: toPublicMerchantDto(updated) }, 200);
  });
}
