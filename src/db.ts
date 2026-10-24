import Database from "better-sqlite3-multiple-ciphers";
import { closeSync, mkdirSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

/**
 * Open the database, encrypted (SQLite3MultipleCiphers, ChaCha20) when `key` is given: 64 hex chars (32 bytes).
 * A plaintext database is encrypted in place the first time it is opened with a key. Without a key (dev, tests)
 * the file stays plaintext. A wrong or missing key throws SQLITE_NOTADB here (at startup), not on the first query.
 */
export function openDb(path: string, key?: string): Database.Database {
  if (key && !/^[0-9a-f]{64}$/i.test(key)) throw new Error("DB_KEY must be 64 hex characters");
  const d = new Database(path);
  if (key) d.pragma(isPlaintext(path) ? `hexrekey='${key}'` : `hexkey='${key}'`);
  d.prepare("SELECT count(*) FROM sqlite_master").get();
  return d;
}

/** True for an existing, non-empty file with the plain SQLite header (an encrypted file's header is random). */
function isPlaintext(path: string): boolean {
  const buf = Buffer.alloc(16);
  let fd: number;
  try { fd = openSync(path, "r"); } catch { return false; }
  try { return readSync(fd, buf, 0, 16, 0) === 16 && buf.toString("latin1") === "SQLite format 3\0"; }
  finally { closeSync(fd); }
}

const dataDir = process.env.DATA_DIR ?? "data";
mkdirSync(dataDir, { recursive: true });
export const db = openDb(join(dataDir, "fin.db"), process.env.DB_KEY || undefined);

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

/** Run `fn` inside BEGIN/COMMIT, rolling back if it throws. */
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN");
  try { const out = fn(); db.exec("COMMIT"); return out; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

function addColumn(table: string, column: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn("accounts", "owner_detected", "TEXT");
addColumn("accounts", "owner_override", "TEXT");
addColumn("accounts", "group_override", "TEXT");
// Unused since Plaid Identity was removed (2026-10-24); kept because migrations are additive only.
addColumn("items", "identity_status", "TEXT");
addColumn("items", "nickname", "TEXT");
addColumn("items", "created_at", "TEXT");
addColumn("accounts", "hidden", "INTEGER NOT NULL DEFAULT 0");
// Investment accounts only: null = automatic | 1 = show a register | 0 = balance only.
addColumn("accounts", "register_override", "INTEGER");
// Date (YYYY-MM-DD) of the last /investments/transactions/get for an investment account with a register.
addColumn("accounts", "inv_tx_synced", "TEXT");

// Investment positions (from /investments/holdings/get), replaced per Item on every sync. The security's display
// fields are copied in: Plaid's security_id is not a stable key (it can change on a corporate action).
// `price`/`price_as_of`/`value` are whichever of the broker's price and the market close is fresher.
// Daily history (one row per account / position per UTC date, overwritten by later syncs that day) exists so
// value-over-time charts become possible: Plaid has no historical balances or holdings.
db.exec(`
CREATE TABLE IF NOT EXISTS holdings (
  account_id TEXT NOT NULL,
  security_id TEXT NOT NULL,
  name TEXT,
  ticker TEXT,
  security_type TEXT,             -- Plaid's security type: equity, etf, mutual fund, fixed income, cash, ...
  sector TEXT,
  is_cash INTEGER NOT NULL DEFAULT 0,
  quantity REAL NOT NULL,
  price REAL,
  price_as_of TEXT,
  value REAL NOT NULL,
  cost_basis REAL,
  vested_value REAL,
  currency TEXT,
  PRIMARY KEY (account_id, security_id)
);
CREATE TABLE IF NOT EXISTS balance_history (
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
  balance REAL,                   -- Plaid's current balance, unsigned like accounts.current_balance
  PRIMARY KEY (account_id, date)
);
CREATE TABLE IF NOT EXISTS holding_history (
  account_id TEXT NOT NULL,
  security_id TEXT NOT NULL,
  date TEXT NOT NULL,
  ticker TEXT,
  name TEXT,
  quantity REAL NOT NULL,
  price REAL,
  value REAL NOT NULL,
  PRIMARY KEY (account_id, security_id, date)
);
`);

// One definition of "who owns this account": manual override, else the owner Plaid Identity detected before it was
// removed (owner_detected, no longer written), else Unassigned.
// And of "has a transaction register": every non-investment account has one; an investment account follows its
// manual override, else `register_auto` (only cash management accounts, which Schwab and others type as investment).
// Recreated on every start so a changed definition reaches existing databases.
db.exec(`DROP VIEW IF EXISTS account_view;
CREATE VIEW account_view AS
  SELECT v.*, CASE WHEN v.type != 'investment' THEN 1 ELSE COALESCE(v.register_override, v.register_auto) END AS register
  FROM (SELECT a.*, COALESCE(a.owner_override, a.owner_detected, 'Unassigned') AS owner,
    (a.type != 'investment' OR lower(COALESCE(a.subtype, '')) = 'cash management') AS register_auto FROM accounts a) v`);

// Passkey login. One shared family dashboard, so there are no user accounts: any registered passkey signs in.
db.exec(`
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,            -- credential id (base64url)
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT,                -- JSON array
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,    -- sha256 of the cookie value; the raw token is never stored
  passkey_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,    -- one-time link to add a passkey on another device
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`);
