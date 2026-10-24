import type { Holding, InvestmentTransaction, RemovedTransaction, Security, Transaction } from "plaid";
import { ownerFromNames } from "./classify.js";
import { db, transaction } from "./db.js";
import { invalidatePlaidStatus } from "./plaidStatus.js";
import { plaid, plaidError } from "./plaid.js";
import type { ItemRow } from "./types.js";

export type SyncItem = Pick<ItemRow, "item_id" | "access_token" | "cursor" | "identity_status">;

type Phase = "balances" | "owners" | "transactions" | "holdings";
export type SyncEvent =
  | { event: "start"; institutions: string[] }
  | { event: "item_start"; institution: string }
  | { event: "phase"; institution: string; phase: Phase; detail: string }
  | { event: "item_done"; result: SyncResult }
  | { event: "done"; results: SyncResult[] };
export type Progress = (e: SyncEvent) => void;

export interface SyncResult {
  institution: string; ok: boolean; error?: string;
  accounts: number; registerAccounts: number; balanceOnlyAccounts: number;
  added: number; modified: number; removed: number; ownersDetected: number; holdings: number;
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
const snapshotBalance = db.prepare("INSERT OR REPLACE INTO balance_history (account_id, date, balance) VALUES (?, ?, ?)");

interface Registers {
  /** Accounts whose transactions come from /transactions/sync. */
  cash: Set<string>;
  /** Investment accounts with a register (e.g. cash management): their activity comes from /investments/transactions/get. */
  investment: { account_id: string; inv_tx_synced: string | null }[];
}

async function syncBalances(item: SyncItem): Promise<{ registers: Registers; investmentAccounts: string[]; total: number }> {
  const { data } = await plaid.accountsGet({ access_token: item.access_token });
  const now = new Date().toISOString(), today = now.slice(0, 10);
  transaction(() => {
    for (const a of data.accounts) {
      upsertAccount.run(
        a.account_id, item.item_id, a.official_name ?? a.name, a.mask ?? null, a.type, a.subtype ?? null,
        a.balances.current ?? null, a.balances.available ?? null, a.balances.iso_currency_code ?? "USD", now,
      );
      snapshotBalance.run(a.account_id, today, a.balances.current ?? null);
    }
  });
  // account_view decides which accounts have a register (most investment accounts show a balance only).
  // Only accounts Plaid still returns: a closed account left in the database would be rejected in account_ids.
  const live = new Set(data.accounts.map((a) => a.account_id));
  const rows = (db.prepare("SELECT account_id, type, inv_tx_synced FROM account_view WHERE item_id = ? AND register = 1")
    .all(item.item_id) as { account_id: string; type: string; inv_tx_synced: string | null }[]).filter((r) => live.has(r.account_id));
  const cash = new Set(rows.filter((r) => r.type !== "investment").map((r) => r.account_id));
  const investment = rows.filter((r) => r.type === "investment");
  const investmentAccounts = data.accounts.filter((a) => a.type === "investment").map((a) => a.account_id);
  return { registers: { cash, investment }, investmentAccounts, total: data.accounts.length };
}

/** Detect account owners via Plaid Identity. Failure here never fails the sync. Stores names only. */
async function syncOwners(item: SyncItem): Promise<number> {
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
  } catch (e) {
    const code = plaidError(e)?.error_code;
    if (code === "ADDITIONAL_CONSENT_REQUIRED" || code === "INVALID_PRODUCT") setStatus.run("needs_consent", item.item_id);
    else if (code === "PRODUCTS_NOT_SUPPORTED") setStatus.run("unsupported", item.item_id);
    else console.error(`identity lookup failed for ${item.item_id}: ${code ?? "unknown error"}`);
    return 0;
  }
}

async function syncTransactions(item: SyncItem, registerAccounts: Set<string>, onFetched: (n: number) => void) {
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
    } catch (e) {
      // Data changed mid-pagination: restart from the last saved cursor.
      if (plaidError(e)?.error_code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") continue;
      throw e;
    }
    const keep = (t: Transaction) => registerAccounts.has(t.account_id);
    transaction(() => {
      for (const t of [...added, ...modified]) {
        if (!keep(t)) continue;
        upsertTx.run(
          t.transaction_id, t.account_id, t.date, t.name, t.merchant_name ?? null,
          t.personal_finance_category?.primary ?? null, t.amount, t.pending ? 1 : 0,
        );
      }
      for (const r of removed) deleteTx.run(r.transaction_id!);
      db.prepare("UPDATE items SET cursor = ? WHERE item_id = ?").run(next ?? null, item.item_id);
    });
    return { added: added.filter(keep).length, modified: modified.filter(keep).length, removed: removed.length };
  }
}

const DAY = 86_400_000;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Cash activity for investment accounts that have a register. /transactions/sync never covers investment
 * accounts, so this reads /investments/transactions/get: the full history (Plaid keeps 24 months) the first time,
 * then the last 30 days so late corrections and cancellations land. The window is replaced as a whole.
 */
async function syncInvestmentTransactions(item: SyncItem, accounts: Registers["investment"], onFetched: (n: number) => void) {
  const now = Date.now(), end = isoDate(now);
  const start = isoDate(Math.min(...accounts.map((a) => a.inv_tx_synced ? Date.parse(a.inv_tx_synced) - 30 * DAY : now - 730 * DAY)));
  const ids = accounts.map((a) => a.account_id);
  const fetched: InvestmentTransaction[] = [];
  try {
    for (let total = Infinity; fetched.length < total;) {
      const { data } = await plaid.investmentsTransactionsGet({
        access_token: item.access_token, start_date: start, end_date: end,
        options: { account_ids: ids, count: 500, offset: fetched.length },
      });
      fetched.push(...data.investment_transactions);
      total = data.total_investment_transactions;
      onFetched(fetched.length);
      if (data.investment_transactions.length === 0) break;
    }
  } catch (e) {
    // Right after Link the investments data may still be loading; the next sync picks it up.
    if (plaidError(e)?.error_code === "PRODUCT_NOT_READY") return { added: 0, removed: 0 };
    throw e;
  }
  const inList = ids.map(() => "?").join(",");
  const before = new Set((db.prepare(`SELECT transaction_id FROM transactions WHERE account_id IN (${inList}) AND date >= ?`)
    .all(...ids, start) as { transaction_id: string }[]).map((r) => r.transaction_id));
  transaction(() => {
    db.prepare(`DELETE FROM transactions WHERE account_id IN (${inList}) AND date >= ?`).run(...ids, start);
    for (const t of fetched) {
      // Same sign convention as /transactions/sync: positive = money out. The subtype (deposit, dividend, buy…) is the category.
      upsertTx.run(t.investment_transaction_id, t.account_id, t.date, t.name, null, t.subtype ?? t.type ?? null, t.amount, 0);
    }
    db.prepare(`UPDATE accounts SET inv_tx_synced = ? WHERE account_id IN (${inList})`).run(end, ...ids);
  });
  const after = new Set(fetched.map((t) => t.investment_transaction_id));
  return { added: [...after].filter((id) => !before.has(id)).length, removed: [...before].filter((id) => !after.has(id)).length };
}

// Plaid errors that mean "no holdings for this Item right now", not a failed sync: data still loading after Link,
// the institution or Item doesn't offer Investments, or the Item was linked without Investments consent.
const HOLDINGS_UNAVAILABLE = new Set([
  "PRODUCT_NOT_READY", "PRODUCTS_NOT_SUPPORTED", "NO_INVESTMENT_ACCOUNTS", "ADDITIONAL_CONSENT_REQUIRED", "INVALID_PRODUCT", "CONSENT_NOT_GRANTED",
]);

/** Price and value of a position: the broker's, unless the security's market close is more recent (cash is always the broker's). */
function pricing(h: Holding, s: Security | undefined) {
  const brokerAsOf = h.institution_price_as_of ?? h.institution_price_datetime?.slice(0, 10) ?? null;
  const close = s?.close_price, closeAsOf = s?.close_price_as_of ?? null;
  const cash = !!s?.is_cash_equivalent || s?.type === "cash";
  if (!cash && close != null && closeAsOf && (!brokerAsOf || closeAsOf > brokerAsOf)) {
    return { price: close, asOf: closeAsOf, value: h.quantity * close };
  }
  return { price: h.institution_price, asOf: brokerAsOf, value: h.institution_value };
}

/**
 * Positions in the Item's investment accounts, from /investments/holdings/get (one call returns every account with
 * its securities). Replaces the Item's stored holdings and records today's snapshot. When holdings are unavailable
 * (HOLDINGS_UNAVAILABLE) the previous holdings are kept and null is returned.
 */
async function syncHoldings(item: SyncItem, accountIds: string[]): Promise<number | null> {
  let holdings: Holding[], securities: Security[];
  try {
    ({ data: { holdings, securities } } = await plaid.investmentsHoldingsGet({ access_token: item.access_token }));
  } catch (e) {
    if (HOLDINGS_UNAVAILABLE.has(plaidError(e)?.error_code ?? "")) return null;
    throw e;
  }
  const byId = new Map(securities.map((s) => [s.security_id, s]));
  const today = isoDate(Date.now()), inList = accountIds.map(() => "?").join(",");
  // A security can appear twice in one account (e.g. separate lots): add them up. Unknown cost basis stays unknown.
  const upsert = db.prepare(`
    INSERT INTO holdings (account_id, security_id, name, ticker, security_type, sector, is_cash, quantity, price, price_as_of, value, cost_basis, vested_value, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, security_id) DO UPDATE SET quantity = quantity + excluded.quantity, value = value + excluded.value,
      cost_basis = cost_basis + excluded.cost_basis, vested_value = vested_value + excluded.vested_value`);
  transaction(() => {
    db.prepare(`DELETE FROM holdings WHERE account_id IN (${inList})`).run(...accountIds);
    db.prepare(`DELETE FROM holding_history WHERE account_id IN (${inList}) AND date = ?`).run(...accountIds, today);
    for (const h of holdings) {
      const s = byId.get(h.security_id), p = pricing(h, s);
      upsert.run(
        h.account_id, h.security_id, s?.name ?? null, s?.ticker_symbol ?? null, s?.type ?? null, s?.sector ?? null,
        s?.is_cash_equivalent || s?.type === "cash" ? 1 : 0, h.quantity, p.price, p.asOf, p.value, h.cost_basis ?? null,
        h.vested_value ?? null, h.iso_currency_code ?? "USD",
      );
    }
    db.prepare(`INSERT INTO holding_history (account_id, security_id, date, ticker, name, quantity, price, value)
      SELECT account_id, security_id, ?, ticker, name, quantity, price, value FROM holdings WHERE account_id IN (${inList})`).run(today, ...accountIds);
  });
  return holdings.length;
}

export async function syncItem(item: SyncItem, onProgress: Progress = () => {}): Promise<SyncResult> {
  const institution = (db.prepare("SELECT institution FROM items WHERE item_id = ?").get(item.item_id) as { institution: string } | undefined)?.institution ?? "Unknown";
  const result: SyncResult = { institution, ok: true, accounts: 0, registerAccounts: 0, balanceOnlyAccounts: 0, added: 0, modified: 0, removed: 0, ownersDetected: 0, holdings: 0 };
  const phase = (p: Phase, detail: string) => onProgress({ event: "phase", institution, phase: p, detail });
  onProgress({ event: "item_start", institution });
  try {
    phase("balances", "Fetching accounts and balances…");
    const { registers, investmentAccounts, total } = await syncBalances(item);
    const withRegister = registers.cash.size + registers.investment.length;
    result.accounts = total; result.registerAccounts = withRegister; result.balanceOnlyAccounts = total - withRegister;
    phase("balances", `${total} account${total === 1 ? "" : "s"} updated`);
    if (!item.identity_status) { phase("owners", "Detecting account owners…"); result.ownersDetected = await syncOwners(item); }
    if (registers.cash.size > 0) {
      phase("transactions", "Fetching transactions…");
      Object.assign(result, await syncTransactions(item, registers.cash, (n) => phase("transactions", `${n} transaction changes fetched…`)));
    }
    if (registers.investment.length > 0) {
      phase("transactions", "Fetching investment account activity…");
      const inv = await syncInvestmentTransactions(item, registers.investment, (n) => phase("transactions", `${n} investment transactions fetched…`));
      result.added += inv.added; result.removed += inv.removed;
    }
    if (investmentAccounts.length > 0) {
      phase("holdings", "Fetching investment holdings…");
      result.holdings = (await syncHoldings(item, investmentAccounts)) ?? 0;
    }
    db.prepare("UPDATE items SET last_synced = ?, last_error = NULL WHERE item_id = ?").run(new Date().toISOString(), item.item_id);
  } catch (e) {
    const p = plaidError(e);
    const msg = p?.error_code ? `${p.error_code}: ${p.error_message}` : String(e);
    db.prepare("UPDATE items SET last_error = ? WHERE item_id = ?").run(msg, item.item_id);
    console.error(`sync failed for ${item.item_id}: ${msg}`);
    result.ok = false; result.error = msg;
  }
  invalidatePlaidStatus(item.item_id);
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
    const items = db.prepare("SELECT item_id, access_token, cursor, identity_status, institution FROM items").all() as unknown as (SyncItem & { institution: string })[];
    onProgress({ event: "start", institutions: items.map((i) => i.institution) });
    const results: SyncResult[] = [];
    for (const item of items) results.push(await syncItem(item, onProgress));
    onProgress({ event: "done", results });
    console.log(`synced ${items.length} item(s) at ${new Date().toISOString()}`);
    return results;
  } finally { running = false; }
}
