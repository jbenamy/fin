// Row shapes for the SQLite tables / views (better-sqlite3 returns untyped rows).
export interface ItemRow {
  item_id: string; access_token: string; institution: string; cursor: string | null;
  last_synced: string | null; last_error: string | null;
  identity_status: string | null; nickname: string | null; created_at: string | null;
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
