import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const merchants = sqliteTable("merchants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  bankAccountNumber: text("bank_account_number").notNull(),
  routingNumber: text("routing_number").notNull(),
  taxId: text("tax_id").notNull(),
  feeBps: integer("fee_bps").notNull(),
  taxRateBps: integer("tax_rate_bps").notNull(),
  createdAt: text("created_at").notNull()
});

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  currency: text("currency").notNull().default("USD"),
  subtotalCents: integer("subtotal_cents").notNull(),
  taxRateBps: integer("tax_rate_bps").notNull(),
  taxCents: integer("tax_cents").notNull(),
  feeBps: integer("fee_bps").notNull(),
  feeCents: integer("fee_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  status: text("status").notNull(),
  lineItemsJson: text("line_items_json").notNull(),
  createdAt: text("created_at").notNull(),
  paidAt: text("paid_at")
});

export const ledgerEntries = sqliteTable("ledger_entries", {
  id: text("id").primaryKey(),
  txGroupId: text("tx_group_id").notNull(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  accountCode: text("account_code").notNull(),
  direction: text("direction").notNull(),
  amountCents: integer("amount_cents").notNull(),
  entryType: text("entry_type").notNull(),
  referenceId: text("reference_id").notNull(),
  reversedTxGroupId: text("reversed_tx_group_id"),
  createdAt: text("created_at").notNull()
});

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text("key").notNull(),
    endpoint: text("endpoint").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.key, table.endpoint] })]
);

export const webhookEvents = sqliteTable("webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  receivedAt: text("received_at").notNull()
});

export type MerchantRow = typeof merchants.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
