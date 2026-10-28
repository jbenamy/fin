import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { useTempDb } from "./helpers.js";

useTempDb();
const { db } = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { createSession } = await import("../src/auth.js");

let server: Server, base: string, cookie: string;
// Every request is signed in (the session guard itself is covered in auth.test.ts).
const fetch = (path: string, init: RequestInit = {}) => globalThis.fetch(base + path, { ...init, headers: { cookie, ...init.headers } });
const get = async (path: string) => (await fetch(path)).json() as Promise<any>;
const patch = (path: string, json: unknown) =>
  fetch(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });

before(async () => {
  db.exec(`INSERT INTO items (item_id, access_token, institution) VALUES ('i1','t','Wells Fargo'),('i2','t','Charles Schwab')`);
  const acct = db.prepare(`INSERT INTO accounts (account_id,item_id,name,mask,type,subtype,current_balance,available_balance,currency,owner_detected)
    VALUES (?,?,?,?,?,?,?,?, 'USD', ?)`);
  acct.run("chk", "i1", "Checking", "1111", "depository", "checking", 1000, 900, "Alex Smith");
  acct.run("card", "i1", "Gold Card", "2222", "credit", "credit card", 250, null, "Alex Smith");
  acct.run("joint", "i1", "Joint Savings", "3333", "depository", "savings", 500, 500, "Sam Smith");
  acct.run("brk", "i2", "Brokerage", "4444", "investment", "brokerage", 9000, null, "Sam Smith");
  const tx = db.prepare(`INSERT INTO transactions (transaction_id,account_id,date,name,merchant,category,amount,pending) VALUES (?,?,?,?,?,NULL,1,0)`);
  // 257 checking rows spread over 9 dates so many share a date (exercises the keyset tiebreak).
  for (let n = 0; n < 257; n++) tx.run("t" + String(n).padStart(4, "0"), "chk", `2026-09-0${1 + (n % 9)}`, "x", null);
  tx.run("p1", "joint", "2026-10-01", "AMAZON MKTPLACE", "Amazon");
  tx.run("p2", "joint", "2026-10-02", "amazon prime", "amazon");
  tx.run("p3", "joint", "2026-10-03", "AMZN Digital", "Amazon Digital");
  tx.run("p4", "joint", "2026-10-04", "SHELL OIL 12", null);
  tx.run("b1", "brk", "2026-10-05", "should never appear", null); // investment accounts have no register
  const holding = db.prepare(`INSERT INTO holdings (account_id,security_id,name,ticker,security_type,is_cash,quantity,price,price_as_of,value,cost_basis)
    VALUES ('brk',?,?,?,?,?,?,?,?,?,?)`);
  const today = new Date().toISOString().slice(0, 10); // fresh prices must stay fresh whenever the test runs
  holding.run("s1", "Vanguard Total Stock Market ETF", "VTI", "etf", 0, 30, 200, today, 6000, 4000);
  holding.run("s2", "Apple Inc", "AAPL", "equity", 0, 10, 200, "2000-01-01", 2000, null);
  holding.run("s3", "Money Market", "SPAXX", "mutual fund", 1, 1000, 1, today, 1000, 1000);
  db.exec(`INSERT INTO passkeys (id, public_key, counter, label, created_at) VALUES ('pk', x'00', 0, 'Test', '2026-10-01')`);
  cookie = "fin_session=" + createSession("pk");
  server = createApp().listen(0);
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(() => { server.close(); });

test("accounts API: signed balance, kind, group rank; hidden accounts excluded", async () => {
  const rows = await get("/api/accounts");
  const card = rows.find((a: any) => a.account_id === "card");
  assert.equal(card.balance, -250);                 // credit shown as owed
  assert.equal(card.kind, "debt");
  assert.equal(rows.find((a: any) => a.account_id === "brk").kind, "investment");
  assert.ok(rows.find((a: any) => a.account_id === "chk").group_rank < card.group_rank);
  assert.equal(rows.find((a: any) => a.account_id === "chk").owner, "Alex Smith");
  // The connection label names only the account's own owner, not everyone on the login.
  assert.equal(rows.find((a: any) => a.account_id === "chk").connection, "Alex Smith");
  assert.equal(rows.find((a: any) => a.account_id === "joint").connection, "Sam Smith");

  await patch("/api/accounts/joint", { hidden: true });
  assert.ok(!(await get("/api/accounts")).some((a: any) => a.account_id === "joint"));
  assert.equal((db.prepare("SELECT hidden FROM accounts WHERE account_id = 'joint'").get() as any).hidden, 1);   // still stored, just not listed
  await patch("/api/accounts/joint", { hidden: false });
});

test("owner override moves an account (and its transactions) to another owner; clearing restores it", async () => {
  const before = (await get("/api/transactions?limit=500&owner=Alex%20Smith")).rows.length;
  await patch("/api/accounts/joint", { owner: "Alex Smith" });
  const acct = (await get("/api/accounts")).find((a: any) => a.account_id === "joint");
  assert.equal(acct.owner, "Alex Smith");
  assert.equal(acct.owner_detected, "Sam Smith");   // detection is untouched
  assert.equal(acct.item_id, "i1");                      // still on the same connection
  assert.equal((await get("/api/transactions?limit=500&owner=Alex%20Smith")).rows.length, before + 4);
  await patch("/api/accounts/joint", { owner: "" });
  assert.equal((await get("/api/accounts")).find((a: any) => a.account_id === "joint").owner, "Sam Smith");
});

test("register pages through every row exactly once, in order, even with same-date ties", async () => {
  const seen: [string, string][] = [];
  let cursor: { date: string; id: string } | null = null, pages = 0;
  do {
    const q: string = cursor ? `&before_date=${cursor.date}&before_id=${cursor.id}` : "";
    const page = await get(`/api/transactions?limit=100&account=chk${q}`);
    pages++;
    for (const r of page.rows) seen.push([r.date, r.transaction_id]);
    cursor = page.next;
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(seen.length, 257);
  assert.equal(new Set(seen.map((s) => s.join())).size, 257);
  const sorted = [...seen].sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : b[0].localeCompare(a[0])));
  assert.deepEqual(seen, sorted);
});

test("balance-only investment accounts never appear in registers", async () => {
  const rows = (await get("/api/transactions?limit=500&owner=Sam%20Smith")).rows;
  assert.ok(!rows.some((r: any) => r.account_id === "brk"));
  assert.equal((await get("/api/accounts")).find((a: any) => a.account_id === "brk").register, false);
});

test("switching on an investment account's register shows its transactions; null goes back to automatic", async () => {
  assert.equal((await patch("/api/accounts/brk", { register: true })).status, 200);
  const brk = (await get("/api/accounts")).find((a: any) => a.account_id === "brk");
  assert.deepEqual([brk.register, brk.register_override, brk.register_auto, brk.kind], [true, true, false, "investment"]);
  assert.ok((await get("/api/transactions?account=brk")).rows.some((r: any) => r.transaction_id === "b1"));
  await patch("/api/accounts/brk", { register: null });
  assert.deepEqual((await get("/api/accounts")).filter((a: any) => a.account_id === "brk").map((a: any) => [a.register, a.register_override]), [[false, null]]);
  assert.equal((await get("/api/transactions?account=brk")).rows.length, 0);
});

test("payee search merges case variants, ranks prefix matches first, and treats % literally", async () => {
  const r = await get("/api/payees?account=joint&q=am");
  assert.deepEqual(r.payees.map((p: any) => [p.payee, p.count]), [["Amazon", 2], ["Amazon Digital", 1]]);
  assert.equal(r.total, 2);
  assert.equal((await get("/api/transactions?account=joint&payee=AMAZON&limit=50")).rows.length, 2);   // exact, case-insensitive
  assert.equal((await get("/api/transactions?account=joint&q=amzn&limit=50")).rows.length, 1);         // substring on the raw name
  assert.equal((await get("/api/transactions?account=joint&q=%25&limit=50")).rows.length, 0);          // "%" is not a wildcard
});

test("groups endpoint lists the display order", async () => {
  const groups = await get("/api/groups");
  assert.equal(groups[0], "Checking");
  assert.ok(groups.includes("401(k)"));
});

test("clean URLs: every page serves the app; .html addresses redirect and keep the query string; unknown paths 404", async () => {
  for (const path of ["/", "/accounts", "/connections", "/passkeys"]) {
    const page = await fetch(path);
    assert.equal(page.status, 200, path);
    assert.match(await page.text(), /<title>Fin<\/title>/);
  }
  assert.equal((await fetch("/nope")).status, 404);
  assert.equal((await fetch("/assets/missing.js")).status, 404);
  const r1 = await fetch("/accounts.html?oauth_state_id=abc", { redirect: "manual" });
  assert.equal(r1.status, 301);
  assert.equal(r1.headers.get("location"), "/accounts?oauth_state_id=abc");
  const r2 = await fetch("/index.html", { redirect: "manual" });
  assert.equal(r2.headers.get("location"), "/");
  assert.equal((await fetch("/healthz")).status, 200);
});

test("errors answer JSON: Plaid's message with 500, malformed JSON with 400, other exceptions without detail", async () => {
  const { plaid } = await import("../src/plaid.js");
  const original = plaid.linkTokenCreate;
  (plaid as any).linkTokenCreate = async () => { throw Object.assign(new Error("x"), { response: { data: { error_code: "INVALID_FIELD", error_message: "bad field" } } }); };
  const err = console.error;
  console.error = () => {};
  try {
    const r = await fetch("/api/link-token", { method: "POST" });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: "bad field" });
    const bad = await fetch("/api/items/i1", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{" });
    assert.equal(bad.status, 400);
    assert.ok((await bad.json()).error);
    // Anything else is logged but not echoed back.
    (plaid as any).linkTokenCreate = async () => { throw new Error("SQLITE_IOERR /data/fin.db"); };
    const hidden = await fetch("/api/link-token", { method: "POST" });
    assert.deepEqual([hidden.status, await hidden.json()], [500, { error: "Internal server error" }]);
  } finally { plaid.linkTokenCreate = original; console.error = err; }
});

test("holdings API: positions largest first, gain from cost basis, allocation in fixed class order", async () => {
  const data = await get("/api/holdings?account=brk");
  assert.equal(data.synced, true);
  assert.deepEqual(data.holdings.map((h: any) => [h.ticker, h.class, h.pct]), [["VTI", "ETFs", 6000 / 9000], ["AAPL", "Stocks", 2000 / 9000], ["SPAXX", "Cash", 1000 / 9000]]);
  const [vti, aapl] = data.holdings;
  assert.deepEqual([vti.gain, vti.gain_pct, vti.stale], [2000, 0.5, false]);
  assert.deepEqual([aapl.gain, aapl.gain_pct, aapl.stale], [null, null, true]);
  assert.deepEqual(data.allocation.map((c: any) => [c.class, c.slot, c.value]), [["Stocks", 0, 2000], ["ETFs", 1, 6000], ["Cash", 4, 1000]]);
  const none = await get("/api/holdings?account=chk");
  assert.deepEqual([none.synced, none.holdings.length, none.allocation.length], [false, 0, 0]);
});
