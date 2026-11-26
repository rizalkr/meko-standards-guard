import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { PayledgerDb, PayledgerTx } from "../db/index.js";
import { ledgerEntries, type LedgerEntryRow } from "../db/schema.js";
import { assertPositiveCents, sumCents } from "../shared/money.js";
import { ConflictError, LedgerImbalanceError, NotFoundError, ValidationError } from "../shared/types.js";

export const ACCOUNT_CODES = {
  PLATFORM_CLEARING: "PLATFORM_CLEARING",
  MERCHANT_PAYABLE: "MERCHANT_PAYABLE",
  TAX_LIABILITY: "TAX_LIABILITY",
  FEE_REVENUE: "FEE_REVENUE",
  PAYOUT_SETTLEMENT: "PAYOUT_SETTLEMENT"
} as const;

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];
export type EntryDirection = "DEBIT" | "CREDIT";
export type EntryType = "INVOICE_CAPTURE" | "PAYOUT_SETTLEMENT" | "REVERSAL";

export interface LedgerLineInput {
  accountCode: AccountCode;
  direction: EntryDirection;
  amountCents: number;
}

export interface PostBalancedEntriesInput {
  txGroupId?: string;
  merchantId: string;
  entryType: EntryType;
  referenceId: string;
  reversedTxGroupId?: string | null;
  lines: LedgerLineInput[];
}

export interface LedgerTotals {
  debitCents: number;
  creditCents: number;
  balanced: boolean;
}

function summarizeRows(rows: readonly LedgerEntryRow[]): LedgerTotals {
  const debits: number[] = [];
  const credits: number[] = [];

  for (const row of rows) {
    if (row.direction === "DEBIT") {
      debits.push(row.amountCents);
    } else if (row.direction === "CREDIT") {
      credits.push(row.amountCents);
    }
  }

  const debitCents = sumCents(debits);
  const creditCents = sumCents(credits);
  return {
    debitCents,
    creditCents,
    balanced: debitCents === creditCents
  };
}

export function postBalancedEntries(
  executor: PayledgerDb | PayledgerTx,
  params: PostBalancedEntriesInput
): { txGroupId: string; entries: LedgerEntryRow[] } {
  if (params.lines.length < 2) {
    throw new ValidationError("Double-entry posting requires at least 2 ledger lines");
  }

  const debits: number[] = [];
  const credits: number[] = [];

  for (const line of params.lines) {
    assertPositiveCents(line.amountCents, "line.amountCents");
    if (line.direction === "DEBIT") {
      debits.push(line.amountCents);
    } else {
      credits.push(line.amountCents);
    }
  }

  const debitTotal = sumCents(debits);
  const creditTotal = sumCents(credits);
  if (debitTotal !== creditTotal) {
    throw new LedgerImbalanceError(
      `Unbalanced ledger posting: debit (${debitTotal}) !== credit (${creditTotal})`
    );
  }

  const txGroupId = params.txGroupId ?? `tx_${randomUUID()}`;
  const createdAt = new Date().toISOString();

  const rows: LedgerEntryRow[] = params.lines.map((line) => ({
    id: `le_${randomUUID()}`,
    txGroupId,
    merchantId: params.merchantId,
    accountCode: line.accountCode,
    direction: line.direction,
    amountCents: line.amountCents,
    entryType: params.entryType,
    referenceId: params.referenceId,
    reversedTxGroupId: params.reversedTxGroupId ?? null,
    createdAt
  }));

  executor.insert(ledgerEntries).values(rows).run();
  return { txGroupId, entries: rows };
}

export function getMerchantBalanceCents(
  executor: PayledgerDb | PayledgerTx,
  merchantId: string
): number {
  const rows = executor
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.merchantId, merchantId),
        eq(ledgerEntries.accountCode, ACCOUNT_CODES.MERCHANT_PAYABLE)
      )
    )
    .all();

  const credits: number[] = [];
  const debits: number[] = [];
  for (const row of rows) {
    if (row.direction === "CREDIT") {
      credits.push(row.amountCents);
    } else if (row.direction === "DEBIT") {
      debits.push(row.amountCents);
    }
  }

  return sumCents(credits) - sumCents(debits);
}

export function listMerchantLedgerEntries(
  executor: PayledgerDb | PayledgerTx,
  merchantId: string
): LedgerEntryRow[] {
  return executor
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.merchantId, merchantId))
    .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id))
    .all();
}

export function getGlobalLedgerTotals(executor: PayledgerDb | PayledgerTx): LedgerTotals {
  const rows = executor.select().from(ledgerEntries).all();
  return summarizeRows(rows);
}

export function getGroupLedgerTotals(
  executor: PayledgerDb | PayledgerTx,
  txGroupId: string
): LedgerTotals {
  const rows = executor
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.txGroupId, txGroupId))
    .all();
  return summarizeRows(rows);
}

export function reverseLedgerGroup(
  tx: PayledgerTx,
  originalTxGroupId: string,
  referenceId: string
): { reversalTxGroupId: string; entries: LedgerEntryRow[] } {
  const originals = tx
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.txGroupId, originalTxGroupId))
    .all();

  if (originals.length === 0) {
    throw new NotFoundError(`Ledger transaction group not found: ${originalTxGroupId}`);
  }

  const existingReversal = tx
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.reversedTxGroupId, originalTxGroupId))
    .get();

  if (existingReversal) {
    throw new ConflictError(`Transaction group ${originalTxGroupId} has already been reversed`);
  }

  const flippedLines: LedgerLineInput[] = originals.map((entry) => ({
    accountCode: entry.accountCode as AccountCode,
    direction: entry.direction === "DEBIT" ? "CREDIT" : "DEBIT",
    amountCents: entry.amountCents
  }));

  const result = postBalancedEntries(tx, {
    merchantId: originals[0].merchantId,
    entryType: "REVERSAL",
    referenceId,
    reversedTxGroupId: originalTxGroupId,
    lines: flippedLines
  });

  return {
    reversalTxGroupId: result.txGroupId,
    entries: result.entries
  };
}
