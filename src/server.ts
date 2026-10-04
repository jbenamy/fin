import { join } from "node:path";
import express from "express";
import cron from "node-cron";
import { CountryCode, Products } from "plaid";
import { accountGroup } from "./classify.js";
import { findDuplicates } from "./duplicates.js";
import { db } from "./db.js";
import { plaid } from "./plaid.js";
import { isSyncRunning, syncAll, syncItem } from "./sync.js";

const app = express();
app.disable("x-powered-by");
app.get("/healthz", (_req, res) => { res.send("ok"); });

app.use(express.json());
app.get("/status.html", (_req, res) => { res.redirect("/connections.html"); });
app.use(express.static(join(import.meta.dirname, "..", "public")));

const wrap = (fn: express.RequestHandler): express.RequestHandler => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((e) => {
    const d = e?.response?.data;
    console.error(d ?? e);
    res.status(500).json({ error: d?.error_message ?? String(e) });
  });

app.post("/api/link-token", wrap(async (req, res) => {
  const base = {
    user: { client_user_id: "owner" },
    client_name: "Fin",
    country_codes: [CountryCode.Us],
    language: "en",
    redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
  };
  const itemId = req.body?.item_id as string | undefined;
  if (itemId) {
    // Update mode: grant an existing Item consent for Identity (owner detection).
    const item = db.prepare("SELECT access_token FROM items WHERE item_id = ?").get(itemId) as { access_token: string } | undefined;
    if (!item) return void res.status(404).json({ error: "unknown item" });
    const { data } = await plaid.linkTokenCreate({ ...base, access_token: item.access_token, additional_consented_products: [Products.Identity] });
    return void res.json({ link_token: data.link_token });
  }
  const { data } = await plaid.linkTokenCreate({
    ...base,
    products: [Products.Transactions],
    required_if_supported_products: [Products.Investments, Products.Identity],
    transactions: { days_requested: 730 },
  });
  res.json({ link_token: data.link_token });
}));

app.post("/api/exchange", wrap(async (req, res) => {
  const { public_token, institution } = req.body as { public_token: string; institution?: string };
  const { data } = await plaid.itemPublicTokenExchange({ public_token });
  db.prepare("INSERT OR REPLACE INTO items (item_id, access_token, institution, created_at) VALUES (?, ?, ?, ?)")
    .run(data.item_id, data.access_token, institution ?? "Unknown", new Date().toISOString());
  await syncItem({ item_id: data.item_id, access_token: data.access_token, cursor: null, identity_status: null });
  res.json({ ok: true });
}));

// After update-mode Link: retry owner detection and sync.
app.post("/api/item-updated", wrap(async (req, res) => {
  const item = db.prepare("SELECT item_id, access_token, cursor FROM items WHERE item_id = ?").get(req.body?.item_id) as any;
  if (!item) return void res.status(404).json({ error: "unknown item" });
  db.prepare("UPDATE items SET identity_status = NULL WHERE item_id = ?").run(item.item_id);
  await syncItem({ ...item, identity_status: null });
  res.json({ ok: true });
}));

// Streams progress as server-sent events (text/event-stream, which Caddy flushes immediately).
app.post("/api/sync", async (_req, res) => {
  if (isSyncRunning()) return void res.status(409).json({ error: "A sync is already running" });
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" }).flushHeaders();
  const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  try { await syncAll(send); } catch (e) { send({ event: "error", error: String(e) }); }
  res.end();
});

// Several logins at one bank (e.g. two Schwab logins) share an institution name, so each connection gets a
// label: the user's nickname, else the owner name(s) on its accounts, else the tail of its item id.
function connectionInfo() {
  const items = db.prepare("SELECT item_id, institution, nickname, created_at FROM items").all() as any[];
  const owners = new Map<string, Set<string>>();
  for (const a of db.prepare("SELECT item_id, COALESCE(owner_override, owner_detected) AS o FROM accounts").all() as any[]) {
    if (a.o) (owners.get(a.item_id) ?? owners.set(a.item_id, new Set()).get(a.item_id)!).add(a.o);
  }
  const perInstitution = new Map<string, number>();
  for (const i of items) perInstitution.set(i.institution, (perInstitution.get(i.institution) ?? 0) + 1);
  return new Map(items.map((i) => {
    const o = [...(owners.get(i.item_id) ?? [])].sort();
    const suffix = String(i.item_id).slice(-6);
    return [i.item_id as string, {
      label: i.nickname || o.join(", ") || `…${suffix}`, owners: o, suffix, nickname: i.nickname as string | null,
      created_at: i.created_at as string | null, multiple: (perInstitution.get(i.institution) ?? 0) > 1,
    }];
  }));
}

app.get("/api/accounts", (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, i.institution, i.last_synced, i.last_error, i.identity_status FROM accounts a
    JOIN items i USING (item_id) WHERE (? = '1' OR a.hidden = 0) ORDER BY i.institution, a.name`).all(String(req.query.all ?? "")) as any[];
  const conn = connectionInfo();
  res.json(rows.map((a) => ({
    ...a,
    connection: conn.get(a.item_id)?.label ?? null,
    multiple_connections: conn.get(a.item_id)?.multiple ?? false,
    owner: a.owner_override || a.owner_detected || "Unassigned",
    group: a.group_override || accountGroup(a.type, a.subtype),
  })));
});

// Unlink: revoke the Item at Plaid (ends its billing and access), then delete its data here.
app.delete("/api/items/:id", wrap(async (req, res) => {
  const id = String(req.params.id);
  const item = db.prepare("SELECT access_token FROM items WHERE item_id = ?").get(id) as { access_token: string } | undefined;
  if (!item) return void res.status(404).json({ error: "unknown connection" });
  try { await plaid.itemRemove({ access_token: item.access_token }); }
  catch (e: any) {
    // Already gone at Plaid's end: still clean up locally. Any other failure aborts so we never orphan a live token.
    const code = e?.response?.data?.error_code;
    if (code !== "ITEM_NOT_FOUND" && code !== "INVALID_ACCESS_TOKEN") throw e;
  }
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM transactions WHERE account_id IN (SELECT account_id FROM accounts WHERE item_id = ?)").run(id);
    db.prepare("DELETE FROM accounts WHERE item_id = ?").run(id);
    db.prepare("DELETE FROM items WHERE item_id = ?").run(id);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  res.json({ ok: true });
}));

app.patch("/api/items/:id", wrap(async (req, res) => {
  const nick = typeof req.body?.nickname === "string" && req.body.nickname.trim() ? req.body.nickname.trim().slice(0, 60) : null;
  db.prepare("UPDATE items SET nickname = ? WHERE item_id = ?").run(nick, String(req.params.id));
  res.json({ ok: true });
}));

// Manual correction of the detected owner / group. Send null (or "") to clear an override.
app.patch("/api/accounts/:id", wrap(async (req, res) => {
  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
  const { owner, group, hidden } = req.body ?? {};
  if (typeof hidden === "boolean") db.prepare("UPDATE accounts SET hidden = ? WHERE account_id = ?").run(hidden ? 1 : 0, String(req.params.id));
  if (owner !== undefined) db.prepare("UPDATE accounts SET owner_override = ? WHERE account_id = ?").run(clean(owner), String(req.params.id));
  if (group !== undefined) db.prepare("UPDATE accounts SET group_override = ? WHERE account_id = ?").run(clean(group), String(req.params.id));
  res.json({ ok: true });
}));

// Per-connection health, merged from our DB and Plaid's /item/get. Only Items linked through this app
// are listed (we can only query Plaid with access tokens we hold). Tokens are never returned.
app.get("/api/status", wrap(async (_req, res) => {
  const items = db.prepare("SELECT item_id, access_token, institution, last_synced, last_error, identity_status FROM items ORDER BY institution").all() as any[];
  const accounts = db.prepare("SELECT * FROM accounts ORDER BY name").all() as any[];
  const conn = connectionInfo();
  const out = await Promise.all(items.map(async (i) => {
    let plaidInfo: Record<string, unknown> | null = null, plaidError: string | null = null;
    try {
      const { data } = await plaid.itemGet({ access_token: i.access_token });
      plaidInfo = {
        error: data.item.error ? `${data.item.error.error_code}: ${data.item.error.error_message}` : null,
        update_type: data.item.update_type,
        consent_expiration_time: data.item.consent_expiration_time ?? null,
        consented_products: data.item.consented_products ?? [],
        transactions_last_success: data.status?.transactions?.last_successful_update ?? null,
        transactions_last_failure: data.status?.transactions?.last_failed_update ?? null,
        investments_last_success: data.status?.investments?.last_successful_update ?? null,
        investments_last_failure: data.status?.investments?.last_failed_update ?? null,
      };
    } catch (e: any) {
      plaidError = e?.response?.data?.error_code ?? String(e);
    }
    const c = conn.get(i.item_id)!;
    return {
      item_id: i.item_id, institution: i.institution, label: c.label, nickname: c.nickname, owners: c.owners,
      suffix: c.suffix, created_at: c.created_at, multiple: c.multiple,
      transaction_count: (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE account_id IN (SELECT account_id FROM accounts WHERE item_id = ?)").get(i.item_id) as { n: number }).n, last_synced: i.last_synced, last_error: i.last_error,
      identity_status: i.identity_status, plaid: plaidInfo, plaid_error: plaidError,
      accounts: accounts.filter((a) => a.item_id === i.item_id).map((a) => ({
        name: a.name, mask: a.mask, type: a.type, subtype: a.subtype, group: a.group_override || accountGroup(a.type, a.subtype),
        account_id: a.account_id, hidden: !!a.hidden, owner: a.owner_override || a.owner_detected || "Unassigned",
        owner_detected: a.owner_detected ?? null, owner_override: a.owner_override ?? null, balance: a.current_balance, currency: a.currency, balance_as_of: a.updated_at,
      })),
    };
  }));
  res.json(out);
}));

// Same underlying account reachable through more than one linked Item (e.g. spouses with joint accounts).
app.get("/api/duplicates", (_req, res) => {
  const rows = db.prepare(`SELECT a.account_id, a.item_id, i.institution, a.name, a.mask, a.type, a.subtype, a.current_balance,
    COALESCE(a.owner_override, a.owner_detected, 'Unassigned') AS owner FROM accounts a JOIN items i USING (item_id) WHERE a.hidden = 0`).all() as any[];
  res.json(findDuplicates(rows));
});

// Shared by the register and payee search: which transactions are in scope (account or owner; never investment/hidden).
const PAYEE = "COALESCE(NULLIF(t.merchant, ''), t.name)";
const SCOPE = `a.type != 'investment' AND a.hidden = 0 AND (? = '' OR t.account_id = ?)
  AND (? = '' OR COALESCE(a.owner_override, a.owner_detected, 'Unassigned') = ?)`;
const scopeArgs = (req: express.Request) => {
  const account = String(req.query.account ?? ""), owner = String(req.query.owner ?? "");
  return [account, account, owner, owner];
};

// Keyset-paginated register: newest first, ordered by (date DESC, transaction_id ASC).
// Pass the previous response's `next` as before_date/before_id to get the following page.
// `payee` = exact payee (case-insensitive); `q` = substring match on payee or raw name.
app.get("/api/transactions", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const beforeDate = String(req.query.before_date ?? ""), beforeId = String(req.query.before_id ?? "");
  const payee = String(req.query.payee ?? ""), q = String(req.query.q ?? "");
  const rows = db.prepare(`
    SELECT t.* FROM transactions t JOIN accounts a USING (account_id)
    WHERE ${SCOPE}
      AND (? = '' OR lower(${PAYEE}) = lower(?))
      AND (? = '' OR instr(lower(${PAYEE}), lower(?)) > 0 OR instr(lower(t.name), lower(?)) > 0)
      AND (? = '' OR t.date < ? OR (t.date = ? AND t.transaction_id > ?))
    ORDER BY t.date DESC, t.transaction_id LIMIT ?`)
    .all(...scopeArgs(req), payee, payee, q, q, q, beforeDate, beforeDate, beforeDate, beforeId, limit + 1) as any[];
  const more = rows.length > limit;
  if (more) rows.pop();
  const last = rows[rows.length - 1];
  res.json({ rows, next: more && last ? { date: last.date, id: last.transaction_id } : null });
});

// Distinct payees (with transaction counts) matching `q`, for the search dropdown. Prefix matches first, then most frequent.
app.get("/api/payees", (req, res) => {
  const q = String(req.query.q ?? "");
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);
  const where = `${SCOPE} AND (? = '' OR instr(lower(${PAYEE}), lower(?)) > 0)`;
  const args = [...scopeArgs(req), q, q];
  const payees = db.prepare(`
    SELECT MIN(${PAYEE}) AS payee, COUNT(*) AS count FROM transactions t JOIN accounts a USING (account_id)
    WHERE ${where} GROUP BY lower(${PAYEE})
    ORDER BY (instr(lower(${PAYEE}), lower(?)) = 1) DESC, count DESC, payee LIMIT ?`).all(...args, q, limit) as any[];
  const total = (db.prepare(`SELECT COUNT(DISTINCT lower(${PAYEE})) AS n FROM transactions t JOIN accounts a USING (account_id) WHERE ${where}`).get(...args) as { n: number }).n;
  res.json({ payees, total });
});

cron.schedule(process.env.SYNC_CRON ?? "0 6 * * *", () => { syncAll().catch((e) => console.error(String(e))); });

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "0.0.0.0", () => console.log(`http://localhost:${port}`));
