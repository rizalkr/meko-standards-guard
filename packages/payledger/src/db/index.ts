import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type PayledgerDb = BetterSQLite3Database<typeof schema>;
export type PayledgerTx = Parameters<Parameters<PayledgerDb["transaction"]>[0]>[0];

export interface PayledgerDbHandle {
  db: PayledgerDb;
  sqlite: Database.Database;
  close: () => void;
}

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  bank_account_number TEXT NOT NULL,
  routing_number TEXT NOT NULL,
  tax_id TEXT NOT NULL,
  fee_bps INTEGER NOT NULL,
  tax_rate_bps INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  currency TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents INTEGER NOT NULL,
  tax_rate_bps INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  fee_bps INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  line_items_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  tx_group_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_code TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  entry_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  reversed_tx_group_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_tx_group_id
  ON ledger_entries (tx_group_id);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_merchant_account
  ON ledger_entries (merchant_id, account_code);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_reversed_tx_group_id
  ON ledger_entries (reversed_tx_group_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, endpoint)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL
);
`;

export function createPayledgerDb(filename = ":memory:"): PayledgerDbHandle {
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  if (filename !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.exec(INIT_SQL);

  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    close: () => sqlite.close()
  };
}
