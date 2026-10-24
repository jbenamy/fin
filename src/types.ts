// Row shapes for the SQLite tables / views (better-sqlite3 returns untyped rows).
export interface ItemRow {
  item_id: string; access_token: string; institution: string; cursor: string | null;
  last_synced: string | null; last_error: string | null;
  nickname: string | null; created_at: string | null;
}

export interface AccountRow {
  account_id: string; item_id: string; name: string; mask: string | null; type: string; subtype: string | null;
  current_balance: number | null; available_balance: number | null; currency: string | null; updated_at: string | null;
  owner_detected: string | null; owner_override: string | null; group_override: string | null; hidden: number;
  register_override: number | null; inv_tx_synced: string | null;
}

/** `account_view`: accounts plus the effective owner (manual override, else detected, else "Unassigned")
 * and whether the account has a transaction register (0/1; `register_auto` is the value without the override). */
export interface AccountViewRow extends AccountRow { owner: string; register: number; register_auto: number }

export interface TransactionRow {
  transaction_id: string; account_id: string; date: string; name: string; merchant: string | null;
  category: string | null; amount: number; pending: number;
}

export interface HoldingRow {
  account_id: string; security_id: string; name: string | null; ticker: string | null; security_type: string | null;
  sector: string | null; is_cash: number; quantity: number; price: number | null; price_as_of: string | null;
  value: number; cost_basis: number | null; vested_value: number | null; currency: string | null;
}
