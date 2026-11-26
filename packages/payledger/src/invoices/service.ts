import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PayledgerDb, PayledgerTx } from "../db/index.js";
import { invoices, merchants, type InvoiceRow, type LedgerEntryRow } from "../db/schema.js";
import { ACCOUNT_CODES, postBalancedEntries, type LedgerLineInput } from "../ledger/service.js";
import { assertPositiveCents, multiplyBpsBankers, sumCents } from "../shared/money.js";
import { ConflictError, NotFoundError, ValidationError } from "../shared/types.js";

export interface InvoiceLineItemInput {
  description: string;
  quantity: number;
  unitAmountCents: number;
}

export interface CreateInvoiceInput {
  merchantId: string;
  currency?: string;
  lineItems: InvoiceLineItemInput[];
}

export interface InvoiceDto {
  id: string;
  merchantId: string;
  currency: string;
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  feeBps: number;
  feeCents: number;
  totalCents: number;
  status: string;
  lineItems: InvoiceLineItemInput[];
  createdAt: string;
  paidAt: string | null;
}

function toInvoiceDto(row: InvoiceRow): InvoiceDto {
  return {
    id: row.id,
    merchantId: row.merchantId,
    currency: row.currency,
    subtotalCents: row.subtotalCents,
    taxRateBps: row.taxRateBps,
    taxCents: row.taxCents,
    feeBps: row.feeBps,
    feeCents: row.feeCents,
    totalCents: row.totalCents,
    status: row.status,
    lineItems: JSON.parse(row.lineItemsJson) as InvoiceLineItemInput[],
    createdAt: row.createdAt,
    paidAt: row.paidAt
  };
}

export function createInvoice(db: PayledgerDb, input: CreateInvoiceInput): InvoiceDto {
  if (input.lineItems.length === 0) {
    throw new ValidationError("Invoice must contain at least one line item");
  }

  const merchant = db
    .select()
    .from(merchants)
    .where(eq(merchants.id, input.merchantId))
    .get();
  if (!merchant) {
    throw new NotFoundError(`Merchant not found: ${input.merchantId}`);
  }

  const lineSubtotals = input.lineItems.map((item, idx) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new ValidationError(`lineItems[${idx}].quantity must be a positive integer`);
    }
    assertPositiveCents(item.unitAmountCents, `lineItems[${idx}].unitAmountCents`);
    const lineTotal = item.quantity * item.unitAmountCents;
    if (!Number.isSafeInteger(lineTotal)) {
      throw new ValidationError(`lineItems[${idx}] subtotal exceeds safe integer range`);
    }
    return lineTotal;
  });

  const subtotalCents = sumCents(lineSubtotals);
  const taxCents = multiplyBpsBankers(subtotalCents, merchant.taxRateBps);
  const feeCents = multiplyBpsBankers(subtotalCents, merchant.feeBps);
  const totalCents = sumCents([subtotalCents, taxCents]);

  const row: InvoiceRow = {
    id: `inv_${randomUUID()}`,
    merchantId: merchant.id,
    currency: input.currency ?? "USD",
    subtotalCents,
    taxRateBps: merchant.taxRateBps,
    taxCents,
    feeBps: merchant.feeBps,
    feeCents,
    totalCents,
    status: "OPEN",
    lineItemsJson: JSON.stringify(input.lineItems),
    createdAt: new Date().toISOString(),
    paidAt: null
  };

  db.insert(invoices).values(row).run();
  return toInvoiceDto(row);
}

export function getInvoiceById(db: PayledgerDb, invoiceId: string): InvoiceDto {
  const row = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
  if (!row) {
    throw new NotFoundError(`Invoice not found: ${invoiceId}`);
  }
  return toInvoiceDto(row);
}

export function captureInvoiceInTx(
  tx: PayledgerTx,
  invoiceId: string
): { invoice: InvoiceDto; txGroupId: string; entries: LedgerEntryRow[] } {
  const row = tx.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
  if (!row) {
    throw new NotFoundError(`Invoice not found: ${invoiceId}`);
  }
  if (row.status === "PAID") {
    throw new ConflictError(`Invoice ${invoiceId} is already PAID`);
  }

  const paidAt = new Date().toISOString();
  tx.update(invoices)
    .set({ status: "PAID", paidAt })
    .where(eq(invoices.id, invoiceId))
    .run();

  const updated = tx.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
  if (!updated) {
    throw new NotFoundError(`Invoice not found after update: ${invoiceId}`);
  }

  const merchantPayableCents = row.subtotalCents - row.feeCents;
  const lines: LedgerLineInput[] = [
    {
      accountCode: ACCOUNT_CODES.PLATFORM_CLEARING,
      direction: "DEBIT",
      amountCents: row.totalCents
    }
  ];

  if (merchantPayableCents > 0) {
    lines.push({
      accountCode: ACCOUNT_CODES.MERCHANT_PAYABLE,
      direction: "CREDIT",
      amountCents: merchantPayableCents
    });
  }
  if (row.feeCents > 0) {
    lines.push({
      accountCode: ACCOUNT_CODES.FEE_REVENUE,
      direction: "CREDIT",
      amountCents: row.feeCents
    });
  }
  if (row.taxCents > 0) {
    lines.push({
      accountCode: ACCOUNT_CODES.TAX_LIABILITY,
      direction: "CREDIT",
      amountCents: row.taxCents
    });
  }

  const posted = postBalancedEntries(tx, {
    merchantId: row.merchantId,
    entryType: "INVOICE_CAPTURE",
    referenceId: row.id,
    lines
  });

  return {
    invoice: toInvoiceDto(updated),
    txGroupId: posted.txGroupId,
    entries: posted.entries
  };
}

export function captureInvoice(
  db: PayledgerDb,
  invoiceId: string
): { invoice: InvoiceDto; txGroupId: string; entries: LedgerEntryRow[] } {
  return db.transaction((tx) => captureInvoiceInTx(tx, invoiceId), { behavior: "immediate" });
}
