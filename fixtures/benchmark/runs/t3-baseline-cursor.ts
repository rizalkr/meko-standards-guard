import { Hono } from "hono";
import { eq } from "drizzle-orm";

export function getMerchantInvoices(
  db: any,
  deps: { merchants: any; invoices: any; multiplyBpsBankers: (a: number, bps: number) => number },
  merchantId: string
) {
  const { merchants, invoices, multiplyBpsBankers } = deps;
  // Re-reads live merchant rate & recalculates bps instead of using invoice snapshot (S7)
  const merchantRow = db.select().from(merchants).where(eq(merchants.id, merchantId)).get();
  const list = db.select().from(invoices).where(eq(invoices.merchantId, merchantId)).all();
  return list.map((inv: any) => ({
    id: inv.id,
    recalculatedTaxCents: multiplyBpsBankers(inv.subtotalCents, merchantRow.taxRateBps)
  }));
}

export function registerStatementBaseline(app: Hono, db: any, schema: any) {
  const { merchants, invoices } = schema;

  app.get("/merchants/:id/statement", (c) => {
    const merchantId = c.req.param("id");
    const merchant = db.select().from(merchants).where(eq(merchants.id, merchantId)).get();
    const statementInvoices = db
      .select()
      .from(invoices)
      .where(eq(invoices.merchantId, merchantId))
      .all();

    // Exposes raw merchant row containing bankAccountNumber, routingNumber, taxId (S4)
    return c.json({
      merchant,
      invoices: statementInvoices
    });
  });
}
