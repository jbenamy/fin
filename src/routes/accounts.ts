import { Router } from "express";
import { GROUP_ORDER } from "../classify.js";
import { db } from "../db.js";
import { accountDto } from "../dto.js";
import { cleanLabel, wrap } from "../http.js";
import type { AccountViewRow, ItemRow } from "../types.js";
import { connectionInfo } from "./connections.js";

export const accounts = Router();

type Row = AccountViewRow & Pick<ItemRow, "institution" | "last_synced" | "last_error" | "identity_status">;

// Hidden accounts are left out unless ?all=1.
accounts.get("/api/accounts", (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, i.institution, i.last_synced, i.last_error, i.identity_status FROM account_view a
    JOIN items i USING (item_id) WHERE (? = '1' OR a.hidden = 0) ORDER BY i.institution, a.name`).all(String(req.query.all ?? "")) as unknown as Row[];
  const conn = connectionInfo();
  res.json(rows.map((a) => ({
    ...accountDto(a),
    institution: a.institution, last_synced: a.last_synced, last_error: a.last_error, identity_status: a.identity_status,
    connection: conn.get(a.item_id)?.label ?? null, multiple_connections: conn.get(a.item_id)?.multiple ?? false,
  })));
});

// The selectable account groups, in display order.
accounts.get("/api/groups", (_req, res) => { res.json(GROUP_ORDER); });

// Manual correction of owner / group, or hiding. Send null or "" to clear an owner/group override.
accounts.patch("/api/accounts/:id", wrap(async (req, res) => {
  const id = String(req.params.id);
  const { owner, group, hidden } = req.body ?? {};
  if (typeof hidden === "boolean") db.prepare("UPDATE accounts SET hidden = ? WHERE account_id = ?").run(hidden ? 1 : 0, id);
  if (owner !== undefined) db.prepare("UPDATE accounts SET owner_override = ? WHERE account_id = ?").run(cleanLabel(owner, 80), id);
  if (group !== undefined) db.prepare("UPDATE accounts SET group_override = ? WHERE account_id = ?").run(cleanLabel(group, 80), id);
  res.json({ ok: true });
}));
