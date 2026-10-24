// Shapes of the server's JSON (see src/dto.ts and src/routes/*).

export type Kind = "cash" | "investment" | "debt" | "other";

export interface Account {
  account_id: string; item_id: string; name: string; mask: string | null; type: string; subtype: string | null;
  group: string; group_rank: number; kind: Kind; register: boolean; hidden: boolean;
  owner: string; owner_detected: string | null; owner_override: string | null; group_override: string | null;
  register_override: boolean | null; register_auto: boolean;
  balance: number | null; available: number | null; currency: string; updated_at: string | null;
  institution: string; last_synced: string | null; last_error: string | null;
  connection: string | null; multiple_connections: boolean;
}

export interface Transaction {
  transaction_id: string; account_id: string; date: string; name: string; merchant: string | null;
  category: string | null; amount: number; pending: number;
}

export interface Holding {
  name: string | null; ticker: string | null; class: string; quantity: number;
  price: number | null; price_as_of: string | null; stale: boolean; value: number; pct: number | null;
  cost_basis: number | null; gain: number | null; gain_pct: number | null; vested_value: number | null; currency: string;
}
export interface Holdings {
  synced: boolean; holdings: Holding[];
  allocation: { class: string; slot: number; value: number; pct: number | null }[];
}

export interface PlaidStatus {
  error: string | null; consented_products: string[]; consent_expiration_time: string | null; fetched_at: string;
  transactions_last_success: string | null; transactions_last_failure: string | null;
  investments_last_success: string | null;
}
export interface Item {
  item_id: string; institution: string; label: string; nickname: string | null; suffix: string; owners: string[];
  created_at: string | null; last_synced: string | null; last_error: string | null;
  transaction_count: number; plaid: PlaidStatus | null; plaid_error: string | null; accounts: Account[];
}

export interface Duplicates {
  accounts: { institution: string; type: string; subtype: string | null; mask: string; confidence: "high" | "likely";
    members: { owner: string; name: string; item_id: string; balance: number | null }[] }[];
  connections: { institution: string; item_ids: string[] }[];
}

export interface Passkey { id: string; label: string; created_at: string; last_used: string | null; current: boolean }
