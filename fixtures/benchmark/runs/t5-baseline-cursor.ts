import { Hono } from "hono";
import { eq } from "drizzle-orm";

export function getInvoiceAfterRateChange(
  db: any,
  deps: { merchants: any; invoices: any },
  invoiceId: string
) {
  const { merchants, invoices } = deps;
  const inv = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
  // Queries live merchant rates during invoice read instead of snapshot columns (S7)
  const merchantRow = db.select().from(merchants).where(eq(merchants.id, inv.merchantId)).get();
  return { ...inv, liveFeeBps: merchantRow.feeBps };
}

export function registerRateUpdateBaseline(app: Hono, db: any, schema: any) {
  const { merchants } = schema;

  app.patch("/merchants/:id/rates", async (c) => {
    const merchantId = c.req.param("id");
    const body = (await c.req.json()) as { previewSubtotalCents: number; feeBps: number };

    // Floating-point arithmetic on monetary value (S1)
    const previewFeeCents = body.previewSubtotalCents * 0.029;

    db.update(merchants)
      .set({ feeBps: body.feeBps })
      .where(eq(merchants.id, merchantId))
      .run();

    return c.json({ merchantId, previewFeeCents });
  });
}
