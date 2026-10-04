import type { RemovedTransaction, Transaction } from "plaid";
import { ownerFromNames } from "./classify.js";
import { db } from "./db.js";
import { plaid } from "./plaid.js";

export interface ItemRow { item_id: string; access_token: string; cursor: string | null; identity_status: string | null }

export type SyncEvent =
  | { event: "start"; institutions: string[] }
  | { event: "item_start"; institution: string }
  | { event: "phase"; institution: string; phase: "balances" | "owners" | "transactions"; detail: string }
  | { event: "item_done"; result: SyncResult }
  | { event: "done"; results: SyncResult[] };
export type Progress = (e: SyncEvent) => void;

export interface SyncResult {
  institution: string; ok: boolean; error?: string;
  accounts: number; registerAccounts: number; brokerageAccounts: number;
  added: number; modified: number; removed: number; ownersDetected: number;
}


const upsertAccount = db.prepare(`
  INSERT INTO accounts (account_id, item_id, name, mask, type, subtype, current_balance, available_balance, currency, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(account_id) DO UPDATE SET name=excluded.name, mask=excluded.mask, type=excluded.type,
    subtype=excluded.subtype, current_balance=excluded.current_balance,
    available_balance=excluded.available_balance, currency=excluded.currency, updated_at=excluded.updated_at`);
const upsertTx = db.prepare(`
  INSERT INTO transactions (transaction_id, account_id, date, name, merchant, category, amount, pending)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(transaction_id) DO UPDATE SET account_id=excluded.account_id, date=excluded.date, name=excluded.name,
    merchant=excluded.merchant, category=excluded.category, amount=excluded.amount, pending=excluded.pending`);
const deleteTx = db.prepare("DELETE FROM transactions WHERE transaction_id = ?");

async function syncBalances(item: ItemRow): Promise<{ registerAccounts: Set<string>; total: number }> {
  const { data } = await plaid.accountsGet({ access_token: item.access_token });
  const now = new Date().toISOString();
  const registerAccounts = new Set<string>();
  for (const a of data.accounts) {
    upsertAccount.run(
      a.account_id, item.item_id, a.official_name ?? a.name, a.mask ?? null, a.type, a.subtype ?? null,
      a.balances.current ?? null, a.balances.available ?? null, a.balances.iso_currency_code ?? "USD", now,
    );
    // Brokerage (investment) accounts show a balance only; no transaction register.
    if (a.type !== "investment") registerAccounts.add(a.account_id);
  }
  return { registerAccounts, total: data.accounts.length };
}

/** Detect account owners via Plaid Identity. Failure here never fails the sync. Stores names only. */
async function syncOwners(item: ItemRow): Promise<number> {
  if (item.identity_status) return 0;
  const setStatus = db.prepare("UPDATE items SET identity_status = ? WHERE item_id = ?");
  try {
    const { data } = await plaid.identityGet({ access_token: item.access_token });
    const setOwner = db.prepare("UPDATE accounts SET owner_detected = ? WHERE account_id = ?");
    let n = 0;
    for (const a of data.accounts) {
      const owner = ownerFromNames(a.owners);
      if (owner) { setOwner.run(owner, a.account_id); n++; }
    }
    setStatus.run("ok", item.item_id);
    return n;
  } catch (e: any) {
    const code = e?.response?.data?.error_code;
    if (code === "ADDITIONAL_CONSENT_REQUIRED" || code === "INVALID_PRODUCT") setStatus.run("needs_consent", item.item_id);
    else if (code === "PRODUCTS_NOT_SUPPORTED") setStatus.run("unsupported", item.item_id);
    else console.error(`identity lookup failed for ${item.item_id}: ${code ?? "unknown error"}`);
    return 0;
  }
}

async function syncTransactions(item: ItemRow, registerAccounts: Set<string>, onFetched: (n: number) => void) {
  const saved = item.cursor ?? undefined;
  for (;;) {
    const added: Transaction[] = [], modified: Transaction[] = [];
    const removed: RemovedTransaction[] = [];
    let next = saved, more = true;
    try {
      while (more) {
        const { data } = await plaid.transactionsSync({ access_token: item.access_token, cursor: next, count: 500 });
        added.push(...data.added); modified.push(...data.modified); removed.push(...data.removed);
        more = data.has_more; next = data.next_cursor;
        onFetched(added.length + modified.length + removed.length);
      }
    } catch (e: any) {
      // Data changed mid-pagination: restart from the last saved cursor.
      if (e?.response?.data?.error_code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") continue;
      throw e;
    }
    const keep = (t: Transaction) => registerAccounts.has(t.account_id);
    db.exec("BEGIN");
    try {
      for (const t of [...added, ...modified]) {
        if (!keep(t)) continue;
        upsertTx.run(
          t.transaction_id, t.account_id, t.date, t.name, t.merchant_name ?? null,
          t.personal_finance_category?.primary ?? null, t.amount, t.pending ? 1 : 0,
        );
      }
      for (const r of removed) deleteTx.run(r.transaction_id!);
      db.prepare("UPDATE items SET cursor = ? WHERE item_id = ?").run(next ?? null, item.item_id);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return { added: added.filter(keep).length, modified: modified.filter(keep).length, removed: removed.length };
  }
}

export async function syncItem(item: ItemRow, onProgress: Progress = () => {}): Promise<SyncResult> {
  const institution = (db.prepare("SELECT institution FROM items WHERE item_id = ?").get(item.item_id) as { institution: string } | undefined)?.institution ?? "Unknown";
  const result: SyncResult = { institution, ok: true, accounts: 0, registerAccounts: 0, brokerageAccounts: 0, added: 0, modified: 0, removed: 0, ownersDetected: 0 };
  const phase = (p: "balances" | "owners" | "transactions", detail: string) => onProgress({ event: "phase", institution, phase: p, detail });
  onProgress({ event: "item_start", institution });
  try {
    phase("balances", "Fetching accounts and balances…");
    const { registerAccounts, total } = await syncBalances(item);
    result.accounts = total; result.registerAccounts = registerAccounts.size; result.brokerageAccounts = total - registerAccounts.size;
    phase("balances", `${total} account${total === 1 ? "" : "s"} updated`);
    if (!item.identity_status) { phase("owners", "Detecting account owners…"); result.ownersDetected = await syncOwners(item); }
    if (registerAccounts.size > 0) {
      phase("transactions", "Fetching transactions…");
      Object.assign(result, await syncTransactions(item, registerAccounts, (n) => phase("transactions", `${n} transaction changes fetched…`)));
    }
    db.prepare("UPDATE items SET last_synced = ?, last_error = NULL WHERE item_id = ?").run(new Date().toISOString(), item.item_id);
  } catch (e: any) {
    const msg = e?.response?.data?.error_code
      ? `${e.response.data.error_code}: ${e.response.data.error_message}` : String(e);
    db.prepare("UPDATE items SET last_error = ? WHERE item_id = ?").run(msg, item.item_id);
    console.error(`sync failed for ${item.item_id}: ${msg}`);
    result.ok = false; result.error = msg;
  }
  onProgress({ event: "item_done", result });
  return result;
}

let running = false;
export const isSyncRunning = () => running;

/** Sync every linked Item, one at a time. Only one run at a time (cron and button share this guard). */
export async function syncAll(onProgress: Progress = () => {}): Promise<SyncResult[]> {
  if (running) throw new Error("A sync is already running");
  running = true;
  try {
    const items = db.prepare("SELECT item_id, access_token, cursor, identity_status, institution FROM items").all() as unknown as (ItemRow & { institution: string })[];
    onProgress({ event: "start", institutions: items.map((i) => i.institution) });
    const results: SyncResult[] = [];
    for (const item of items) results.push(await syncItem(item, onProgress));
    onProgress({ event: "done", results });
    console.log(`synced ${items.length} item(s) at ${new Date().toISOString()}`);
    return results;
  } finally { running = false; }
}
