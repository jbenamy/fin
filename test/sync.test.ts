import assert from "node:assert/strict";
import { test } from "node:test";
import { useTempDb } from "./helpers.js";

useTempDb();
const { db } = await import("../src/db.js");
const { plaid } = await import("../src/plaid.js");
const { syncItem } = await import("../src/sync.js");
const { getPlaidStatus, invalidatePlaidStatus } = await import("../src/plaidStatus.js");

const stub = (name: string, fn: (...a: any[]) => unknown) => { (plaid as any)[name] = async (...a: any[]) => ({ data: await fn(...a) }); };
const tx = (id: string, account: string) => ({ transaction_id: id, account_id: account, date: "2026-10-01", name: "x", merchant_name: null, amount: 5, pending: false });

test("sync stores balances and cash transactions, skips brokerage transactions, detects owners", async () => {
  db.exec(`INSERT INTO items (item_id, access_token, institution) VALUES ('i1','tok','Charles Schwab')`);
  stub("accountsGet", () => ({ accounts: [
    { account_id: "cash", name: "Checking", mask: "1", type: "depository", subtype: "checking", balances: { current: 10, available: 9, iso_currency_code: "USD" } },
    { account_id: "brk", name: "Brokerage", mask: "2", type: "investment", subtype: "brokerage", balances: { current: 500, available: null, iso_currency_code: "USD" } },
  ] }));
  stub("identityGet", () => ({ accounts: [
    { account_id: "cash", owners: [{ names: ["ALEX Q SMITH"] }] },
    { account_id: "brk", owners: [{ names: ["Alex Smith"] }, { names: ["Sam Smith"] }] },
  ] }));
  stub("transactionsSync", () => ({ added: [tx("t1", "cash"), tx("t2", "brk")], modified: [], removed: [], has_more: false, next_cursor: "c1" }));

  const result = await syncItem({ item_id: "i1", access_token: "tok", cursor: null, identity_status: null });

  assert.equal(result.ok, true);
  assert.deepEqual([result.accounts, result.registerAccounts, result.balanceOnlyAccounts], [2, 1, 1]);
  assert.deepEqual([result.added, result.modified, result.removed], [1, 0, 0]);   // the brokerage transaction is not counted
  assert.deepEqual(db.prepare("SELECT transaction_id FROM transactions").all().map((r: any) => r.transaction_id), ["t1"]);
  const owners = Object.fromEntries(db.prepare("SELECT account_id, owner FROM account_view").all().map((r: any) => [r.account_id, r.owner]));
  assert.deepEqual(owners, { cash: "Alex Smith", brk: "Alex Smith & Sam Smith" });
  const item = db.prepare("SELECT cursor, identity_status, last_error FROM items").get() as any;
  assert.deepEqual([item.cursor, item.identity_status, item.last_error], ["c1", "ok", null]);
});

test("a manual owner override survives later syncs", async () => {
  db.prepare("UPDATE accounts SET owner_override = 'Someone Else' WHERE account_id = 'cash'").run();
  await syncItem({ item_id: "i1", access_token: "tok", cursor: "c1", identity_status: "ok" });
  assert.equal((db.prepare("SELECT owner FROM account_view WHERE account_id = 'cash'").get() as any).owner, "Someone Else");
});

test("a Plaid failure is recorded on the item instead of throwing", async () => {
  (plaid as any).accountsGet = async () => { throw Object.assign(new Error("x"), { response: { data: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "login required" } } }); };
  const result = await syncItem({ item_id: "i1", access_token: "tok", cursor: null, identity_status: "ok" });
  assert.equal(result.ok, false);
  assert.match(result.error!, /ITEM_LOGIN_REQUIRED/);
  assert.match((db.prepare("SELECT last_error FROM items").get() as any).last_error, /ITEM_LOGIN_REQUIRED/);
});

test("Plaid item status is cached, refreshable, and invalidated", async () => {
  let calls = 0;
  stub("itemGet", () => { calls++; return { item: { error: null, update_type: "background", consented_products: [] }, status: null }; });
  invalidatePlaidStatus("i9");
  await getPlaidStatus("i9", "tok");
  await getPlaidStatus("i9", "tok");
  assert.equal(calls, 1);                       // second call served from cache
  await getPlaidStatus("i9", "tok", true);
  assert.equal(calls, 2);                       // force bypasses the cache
  invalidatePlaidStatus("i9");
  await getPlaidStatus("i9", "tok");
  assert.equal(calls, 3);                       // invalidation drops it
  (plaid as any).itemGet = async () => { throw Object.assign(new Error("x"), { response: { data: { error_code: "RATE_LIMIT" } } }); };
  invalidatePlaidStatus("i9");
  const failed = await getPlaidStatus("i9", "tok");
  assert.deepEqual([failed.info, failed.error], [null, "RATE_LIMIT"]);
});

const invTx = (id: string, account: string, date = "2026-10-01") =>
  ({ investment_transaction_id: id, account_id: account, date, name: "Deposit", amount: -100, type: "cash", subtype: "deposit" });

test("cash management accounts get a register from Investments; plain brokerage stays balance-only", async () => {
  db.exec(`INSERT INTO items (item_id, access_token, institution) VALUES ('i2','tok2','Charles Schwab')`);
  stub("accountsGet", () => ({ accounts: [
    { account_id: "cma", name: "Cash Management", mask: "3", type: "investment", subtype: "cash management", balances: { current: 50, available: 50, iso_currency_code: "USD" } },
    { account_id: "brk2", name: "Brokerage", mask: "4", type: "investment", subtype: "brokerage", balances: { current: 900, available: null, iso_currency_code: "USD" } },
  ] }));
  stub("transactionsSync", () => { throw new Error("transactionsSync should not run for investment-only items"); });
  const calls: any[] = [];
  let pages = [[invTx("v1", "cma"), invTx("v2", "cma")], [invTx("v3", "cma")]];
  stub("investmentsTransactionsGet", (req: any) => {
    calls.push(req);
    const page = pages[req.options.offset === 0 ? 0 : 1];
    return { investment_transactions: page, total_investment_transactions: 3 };
  });

  const r1 = await syncItem({ item_id: "i2", access_token: "tok2", cursor: null, identity_status: "ok" });
  assert.equal(r1.ok, true);
  assert.deepEqual([r1.registerAccounts, r1.balanceOnlyAccounts, r1.added], [1, 1, 3]);
  assert.deepEqual(calls.map((c) => [c.options.account_ids, c.options.offset]), [[["cma"], 0], [["cma"], 2]]);
  const reg = (db.prepare("SELECT category, amount, pending FROM transactions WHERE transaction_id = 'v1'").get() as any);
  assert.deepEqual({ ...reg }, { category: "deposit", amount: -100, pending: 0 });
  const synced = (db.prepare("SELECT inv_tx_synced FROM accounts WHERE account_id = 'cma'").get() as any).inv_tx_synced;
  assert.match(synced, /^\d{4}-\d{2}-\d{2}$/);

  // Later syncs re-read a 30-day window and drop what Plaid no longer returns.
  calls.length = 0;
  db.prepare("UPDATE transactions SET date = ? WHERE transaction_id IN ('v1','v2','v3')").run(synced);
  pages = [[invTx("v1", "cma", synced)], []];
  stub("investmentsTransactionsGet", (req: any) => { calls.push(req); return { investment_transactions: pages[0], total_investment_transactions: 1 }; });
  const r2 = await syncItem({ item_id: "i2", access_token: "tok2", cursor: null, identity_status: "ok" });
  assert.deepEqual([r2.added, r2.removed], [0, 2]);
  assert.equal(calls[0].start_date, new Date(Date.parse(synced) - 30 * 86_400_000).toISOString().slice(0, 10));
  assert.deepEqual(db.prepare("SELECT transaction_id FROM transactions WHERE account_id = 'cma'").all().map((r: any) => r.transaction_id), ["v1"]);
});

test("a brokerage account switched on manually gets a register; PRODUCT_NOT_READY is not a failure", async () => {
  db.prepare("UPDATE accounts SET register_override = 1 WHERE account_id = 'brk2'").run();
  db.prepare("UPDATE accounts SET register_override = 0 WHERE account_id = 'cma'").run();
  const seen: string[][] = [];
  stub("investmentsTransactionsGet", (req: any) => { seen.push(req.options.account_ids); return { investment_transactions: [invTx("v9", "brk2")], total_investment_transactions: 1 }; });
  const r = await syncItem({ item_id: "i2", access_token: "tok2", cursor: null, identity_status: "ok" });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, [["brk2"]]);
  assert.deepEqual([r.registerAccounts, r.balanceOnlyAccounts], [1, 1]);

  (plaid as any).investmentsTransactionsGet = async () => { throw Object.assign(new Error("x"), { response: { data: { error_code: "PRODUCT_NOT_READY" } } }); };
  const r2 = await syncItem({ item_id: "i2", access_token: "tok2", cursor: null, identity_status: "ok" });
  assert.equal(r2.ok, true);
});
