import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const dataDir = process.env.DATA_DIR ?? "data";
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(join(dataDir, "fin.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS items (
  item_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  institution TEXT NOT NULL,
  cursor TEXT,
  last_synced TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mask TEXT,
  type TEXT NOT NULL,
  subtype TEXT,
  current_balance REAL,
  available_balance REAL,
  currency TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  merchant TEXT,
  category TEXT,
  amount REAL NOT NULL,
  pending INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tx_account_date ON transactions(account_id, date DESC);
`);

function addColumn(table: string, column: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn("accounts", "owner_detected", "TEXT");
addColumn("accounts", "owner_override", "TEXT");
addColumn("accounts", "group_override", "TEXT");
// null = not tried yet | ok | needs_consent (re-link in update mode) | unsupported
addColumn("items", "identity_status", "TEXT");
addColumn("items", "nickname", "TEXT");
addColumn("items", "created_at", "TEXT");
addColumn("accounts", "hidden", "INTEGER NOT NULL DEFAULT 0");

// One definition of "who owns this account": manual override, else Plaid-detected, else Unassigned.
db.exec(`CREATE VIEW IF NOT EXISTS account_view AS
  SELECT a.*, COALESCE(a.owner_override, a.owner_detected, 'Unassigned') AS owner FROM accounts a`);
