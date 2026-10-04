import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { useTempDb } from "./helpers.js";

useTempDb();
const { db } = await import("../src/db.js");
const { createApp } = await import("../src/app.js");

let server: Server, base: string;
const get = async (path: string) => (await fetch(base + path)).json() as Promise<any>;
const patch = (path: string, json: unknown) =>
  fetch(base + path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });

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
  server = createApp().listen(0);
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(() => { server.close(); });

test("accounts API: signed balance, kind, group rank; hidden accounts excluded unless ?all=1", async () => {
  const rows = await get("/api/accounts");
  const card = rows.find((a: any) => a.account_id === "card");
  assert.equal(card.balance, -250);                 // credit shown as owed
  assert.equal(card.kind, "debt");
  assert.equal(rows.find((a: any) => a.account_id === "brk").kind, "investment");
  assert.ok(rows.find((a: any) => a.account_id === "chk").group_rank < card.group_rank);
  assert.equal(rows.find((a: any) => a.account_id === "chk").owner, "Alex Smith");

  await patch("/api/accounts/joint", { hidden: true });
  assert.ok(!(await get("/api/accounts")).some((a: any) => a.account_id === "joint"));
  assert.ok((await get("/api/accounts?all=1")).some((a: any) => a.account_id === "joint"));
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

test("investment accounts never appear in registers", async () => {
  const rows = (await get("/api/transactions?limit=500&owner=Sam%20Smith")).rows;
  assert.ok(!rows.some((r: any) => r.account_id === "brk"));
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

test("clean URLs: /accounts serves the page; .html addresses redirect and keep the query string", async () => {
  const page = await fetch(base + "/accounts");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Fin · Accounts<\/title>/);
  const r1 = await fetch(base + "/accounts.html?oauth_state_id=abc", { redirect: "manual" });
  assert.equal(r1.status, 301);
  assert.equal(r1.headers.get("location"), "/accounts?oauth_state_id=abc");
  const r2 = await fetch(base + "/index.html", { redirect: "manual" });
  assert.equal(r2.headers.get("location"), "/");
  assert.equal((await fetch(base + "/connections")).status, 200);
  assert.equal((await fetch(base + "/healthz")).status, 200);
});
