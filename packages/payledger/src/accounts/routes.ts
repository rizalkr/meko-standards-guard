import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { PayledgerDb } from "../db/index.js";
import { merchants } from "../db/schema.js";
import { getMerchantBalanceCents, listMerchantLedgerEntries } from "../ledger/service.js";
import { assertValidBps } from "../shared/money.js";
import { ConflictError, NotFoundError, ValidationError, type AppEnv } from "../shared/types.js";
import { toPublicMerchantDto } from "./dto.js";

const CreateMerchantSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  bankAccountNumber: z.string().trim().min(4),
  routingNumber: z.string().trim().min(4),
  taxId: z.string().trim().min(4),
  feeBps: z.number().int().min(0).max(10_000),
  taxRateBps: z.number().int().min(0).max(10_000)
});

const UpdateRatesSchema = z
  .object({
    feeBps: z.number().int().min(0).max(10_000).optional(),
    taxRateBps: z.number().int().min(0).max(10_000).optional()
  })
  .refine((data) => data.feeBps !== undefined || data.taxRateBps !== undefined, {
    message: "At least one of feeBps or taxRateBps must be provided"
  });

export function createAccountsRoutes(db: PayledgerDb): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/merchants", async (c) => {
    const body = CreateMerchantSchema.parse(await c.req.json());
    assertValidBps(body.feeBps, "feeBps");
    assertValidBps(body.taxRateBps, "taxRateBps");

    const existing = db
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.email, body.email))
      .get();
    if (existing) {
      throw new ConflictError(`Merchant with email ${body.email} already exists`);
    }

    const row = {
      id: `mer_${randomUUID()}`,
      name: body.name,
      email: body.email,
      bankAccountNumber: body.bankAccountNumber,
      routingNumber: body.routingNumber,
      taxId: body.taxId,
      feeBps: body.feeBps,
      taxRateBps: body.taxRateBps,
      createdAt: new Date().toISOString()
    };

    db.insert(merchants).values(row).run();
    return c.json({ merchant: toPublicMerchantDto(row) }, 201);
  });

  app.get("/merchants/:id", (c) => {
    const merchant = db
      .select()
      .from(merchants)
      .where(eq(merchants.id, c.req.param("id")))
      .get();

    if (!merchant) {
      throw new NotFoundError(`Merchant not found: ${c.req.param("id")}`);
    }

    return c.json({ merchant: toPublicMerchantDto(merchant) }, 200);
  });

  app.patch("/merchants/:id/rates", async (c) => {
    const id = c.req.param("id");
    const existing = db.select().from(merchants).where(eq(merchants.id, id)).get();
    if (!existing) {
      throw new NotFoundError(`Merchant not found: ${id}`);
    }

    const body = UpdateRatesSchema.parse(await c.req.json());
    const nextFeeBps = body.feeBps !== undefined ? assertValidBps(body.feeBps, "feeBps") : existing.feeBps;
    const nextTaxRateBps =
      body.taxRateBps !== undefined ? assertValidBps(body.taxRateBps, "taxRateBps") : existing.taxRateBps;

    if (nextFeeBps === existing.feeBps && nextTaxRateBps === existing.taxRateBps) {
      throw new ValidationError("Updated rates match existing values");
    }

    db.update(merchants)
      .set({ feeBps: nextFeeBps, taxRateBps: nextTaxRateBps })
      .where(eq(merchants.id, id))
      .run();

    const updated = db.select().from(merchants).where(eq(merchants.id, id)).get();
    if (!updated) {
      throw new NotFoundError(`Merchant not found: ${id}`);
    }

    return c.json({ merchant: toPublicMerchantDto(updated) }, 200);
  });

  app.get("/merchants/:id/statement", (c) => {
    const id = c.req.param("id");
    const merchant = db.select().from(merchants).where(eq(merchants.id, id)).get();
    if (!merchant) {
      throw new NotFoundError(`Merchant not found: ${id}`);
    }

    const availableBalanceCents = getMerchantBalanceCents(db, id);
    const entries = listMerchantLedgerEntries(db, id);

    return c.json(
      {
        merchant: toPublicMerchantDto(merchant),
        availableBalanceCents,
        entries
      },
      200
    );
  });

  return app;
}
