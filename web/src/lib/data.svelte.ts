// Accounts shared by every page, reloaded after a sync or a new connection. `version` bumps on every change so
// pages with their own data (Connections) know to refetch.
import { api, message } from "./api";
import type { Account } from "./types";

export const data = $state({ accounts: [] as Account[], loaded: false, error: "", version: 0 });

export async function loadAccounts() {
  try { data.accounts = await api<Account[]>("/api/accounts"); data.error = ""; }
  catch (e) { data.error = message(e); }
  data.loaded = true;
}

/** Something changed server-side (sync, link, edit): reload accounts and tell other pages. */
export async function changed() { data.version++; await loadAccounts(); }

/** Manual change to one account (owner, group, hidden, register: see PATCH /api/accounts/:id), then reload. */
export async function updateAccount(id: string, fields: Record<string, unknown>) {
  await api("/api/accounts/" + encodeURIComponent(id), { method: "PATCH", json: fields });
  await changed();
}

/** Most recent sync time across all connections. */
export const lastSynced = () => data.accounts.map((a) => a.last_synced).filter(Boolean).sort().pop() ?? null;
