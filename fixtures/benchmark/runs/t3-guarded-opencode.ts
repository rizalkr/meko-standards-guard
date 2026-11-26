import { Hono } from "hono";
import { eq } from "drizzle-orm";

export function getMerchantInvoices(
  db: any,
  deps: { invoices: any },
  merchantId: string
) {
  const { invoices } = deps;
  return db
    .select({
      id: invoices.id,
      subtotalCents: invoices.subtotalCents,
      taxRateBps: invoices.taxRateBps,
      taxCents: invoices.taxCents,
      feeBps: invoices.feeBps,
      feeCents: invoices.feeCents,
      totalCents: invoices.totalCents,
      status: invoices.status
    })
    .from(invoices)
    .where(eq(invoices.merchantId, merchantId))
    .all();
}

export function registerStatementGuarded(
  app: Hono,
  db: any,
  deps: {
    merchants: any;
    invoices: any;
    toPublicMerchantDto: (merchant: any) => any;
  }
) {
  const { merchants, invoices, toPublicMerchantDto } = deps;

  app.get("/merchants/:id/statement", (c) => {
    const merchantId = c.req.param("id");
    const merchant = db.select().from(merchants).where(eq(merchants.id, merchantId)).get();
    const statementInvoices = getMerchantInvoices(db, { invoices }, merchantId);

    return c.json({
      merchant: toPublicMerchantDto(merchant),
      invoices: statementInvoices
    });
  });
}
