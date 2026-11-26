import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PayledgerDb } from "../db/index.js";
import { ledgerEntries, merchants, type LedgerEntryRow } from "../db/schema.js";
import {
  ACCOUNT_CODES,
  getMerchantBalanceCents,
  postBalancedEntries,
  reverseLedgerGroup
} from "../ledger/service.js";
import { assertPositiveCents } from "../shared/money.js";
import { InsufficientBalanceError, NotFoundError, ValidationError } from "../shared/types.js";

export interface CreatePayoutInput {
  merchantId: string;
  amountCents: number;
  reference?: string;
}

export interface PayoutResult {
  payoutId: string;
  txGroupId: string;
  merchantId: string;
  amountCents: number;
  remainingBalanceCents: number;
  entries: LedgerEntryRow[];
}

export function createPayout(db: PayledgerDb, input: CreatePayoutInput): PayoutResult {
  assertPositiveCents(input.amountCents, "amountCents");

  return db.transaction(
    (tx) => {
      const merchant = tx
        .select({ id: merchants.id })
        .from(merchants)
        .where(eq(merchants.id, input.merchantId))
        .get();
      if (!merchant) {
        throw new NotFoundError(`Merchant not found: ${input.merchantId}`);
      }

      const availableBalanceCents = getMerchantBalanceCents(tx, input.merchantId);
      if (input.amountCents > availableBalanceCents) {
        throw new InsufficientBalanceError(
          `Insufficient payable balance: requested ${input.amountCents}, available ${availableBalanceCents}`
        );
      }

      const payoutId = `po_${randomUUID()}`;
      const posted = postBalancedEntries(tx, {
        txGroupId: payoutId,
        merchantId: input.merchantId,
        entryType: "PAYOUT_SETTLEMENT",
        referenceId: input.reference ?? payoutId,
        lines: [
          {
            accountCode: ACCOUNT_CODES.MERCHANT_PAYABLE,
            direction: "DEBIT",
            amountCents: input.amountCents
          },
          {
            accountCode: ACCOUNT_CODES.PAYOUT_SETTLEMENT,
            direction: "CREDIT",
            amountCents: input.amountCents
          }
        ]
      });

      return {
        payoutId,
        txGroupId: posted.txGroupId,
        merchantId: input.merchantId,
        amountCents: input.amountCents,
        remainingBalanceCents: availableBalanceCents - input.amountCents,
        entries: posted.entries
      };
    },
    { behavior: "immediate" }
  );
}

export function reversePayout(
  db: PayledgerDb,
  payoutTxGroupId: string,
  reason: string
): {
  reversalTxGroupId: string;
  reversedTxGroupId: string;
  reason: string;
  entries: LedgerEntryRow[];
} {
  if (!reason.trim()) {
    throw new ValidationError("Reversal reason is required");
  }

  return db.transaction(
    (tx) => {
      const originals = tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.txGroupId, payoutTxGroupId))
        .all();

      if (originals.length === 0) {
        throw new NotFoundError(`Payout transaction group not found: ${payoutTxGroupId}`);
      }
      if (originals.some((entry) => entry.entryType !== "PAYOUT_SETTLEMENT")) {
        throw new ValidationError(`Transaction group ${payoutTxGroupId} is not a payout settlement`);
      }

      const reversed = reverseLedgerGroup(tx, payoutTxGroupId, reason);
      return {
        reversalTxGroupId: reversed.reversalTxGroupId,
        reversedTxGroupId: payoutTxGroupId,
        reason,
        entries: reversed.entries
      };
    },
    { behavior: "immediate" }
  );
}
