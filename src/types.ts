// Row shapes for the SQLite tables / views (node:sqlite returns untyped rows).
export interface ItemRow {
  item_id: string; access_token: string; institution: string; cursor: string | null;
  last_synced: string | null; last_error: string | null;
  identity_status: string | null; nickname: string | null; created_at: string | null;
}

export interface AccountRow {
  account_id: string; item_id: string; name: string; mask: string | null; type: string; subtype: string | null;
  current_balance: number | null; available_balance: number | null; currency: string | null; updated_at: string | null;
  owner_detected: string | null; owner_override: string | null; group_override: string | null; hidden: number;
}

/** `account_view`: accounts plus the effective owner (manual override, else detected, else "Unassigned"). */
export interface AccountViewRow extends AccountRow { owner: string }

export interface TransactionRow {
  transaction_id: string; account_id: string; date: string; name: string; merchant: string | null;
  category: string | null; amount: number; pending: number;
}
