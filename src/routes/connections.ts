import { Router } from "express";
import { db } from "../db.js";
import { accountDto } from "../dto.js";
import { findDuplicates, type DupAccount } from "../duplicates.js";
import { cleanLabel, wrap } from "../http.js";
import { plaid } from "../plaid.js";
import { getPlaidStatus, invalidatePlaidStatus } from "../plaidStatus.js";
import type { AccountViewRow, ItemRow } from "../types.js";

export const connections = Router();

// Several logins at one bank (e.g. two Schwab logins) share an institution name, so each connection gets a
// label: the user's nickname, else the owner name(s) on its accounts, else the tail of its item id.
export function connectionInfo() {
  const items = db.prepare("SELECT item_id, institution, nickname, created_at FROM items").all() as unknown as Pick<ItemRow, "item_id" | "institution" | "nickname" | "created_at">[];
  const owners = new Map<string, Set<string>>();
  for (const a of db.prepare("SELECT item_id, owner FROM account_view WHERE owner != 'Unassigned'").all() as unknown as { item_id: string; owner: string }[]) {
    (owners.get(a.item_id) ?? owners.set(a.item_id, new Set()).get(a.item_id)!).add(a.owner);
  }
  const perInstitution = new Map<string, number>();
  for (const i of items) perInstitution.set(i.institution, (perInstitution.get(i.institution) ?? 0) + 1);
  return new Map(items.map((i) => {
    const o = [...(owners.get(i.item_id) ?? [])].sort();
    const suffix = i.item_id.slice(-6);
    return [i.item_id, {
      label: i.nickname || o.join(", ") || `…${suffix}`, owners: o, suffix, nickname: i.nickname,
      created_at: i.created_at, multiple: (perInstitution.get(i.institution) ?? 0) > 1,
    }];
  }));
}

// Per-connection health, merged from our DB and Plaid's /item/get (cached ~5 min; ?refresh=1 bypasses).
// Only Items linked through this app are listed (we can only query Plaid with tokens we hold). Tokens are never returned.
connections.get("/api/status", wrap(async (req, res) => {
  const force = req.query.refresh === "1";
  const items = db.prepare("SELECT * FROM items ORDER BY institution").all() as unknown as ItemRow[];
  const accounts = db.prepare("SELECT * FROM account_view ORDER BY name").all() as unknown as AccountViewRow[];
  const txCounts = new Map((db.prepare("SELECT a.item_id, COUNT(*) AS n FROM transactions t JOIN accounts a USING (account_id) GROUP BY a.item_id")
    .all() as unknown as { item_id: string; n: number }[]).map((r) => [r.item_id, r.n]));
  const conn = connectionInfo();
  res.json(await Promise.all(items.map(async (i) => {
    const p = await getPlaidStatus(i.item_id, i.access_token, force);
    const c = conn.get(i.item_id)!;
    return {
      item_id: i.item_id, institution: i.institution, label: c.label, nickname: c.nickname, owners: c.owners,
      suffix: c.suffix, created_at: c.created_at, multiple: c.multiple, transaction_count: txCounts.get(i.item_id) ?? 0,
      last_synced: i.last_synced, last_error: i.last_error, identity_status: i.identity_status,
      plaid: p.info, plaid_error: p.error,
      accounts: accounts.filter((a) => a.item_id === i.item_id).map(accountDto),
    };
  })));
}));

// Same underlying account reachable through more than one linked Item (e.g. spouses with joint accounts).
connections.get("/api/duplicates", (_req, res) => {
  const rows = db.prepare(`SELECT a.account_id, a.item_id, i.institution, a.name, a.mask, a.type, a.subtype, a.current_balance, a.owner
    FROM account_view a JOIN items i USING (item_id) WHERE a.hidden = 0`).all() as unknown as DupAccount[];
  res.json(findDuplicates(rows));
});

connections.patch("/api/items/:id", wrap(async (req, res) => {
  db.prepare("UPDATE items SET nickname = ? WHERE item_id = ?").run(cleanLabel(req.body?.nickname, 60), String(req.params.id));
  res.json({ ok: true });
}));

// Unlink: revoke the Item at Plaid (ends its billing and access), then delete its data here.
connections.delete("/api/items/:id", wrap(async (req, res) => {
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
  invalidatePlaidStatus(id);
  res.json({ ok: true });
}));
