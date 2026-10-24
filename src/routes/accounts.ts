import { Router } from "express";
import { GROUP_ORDER } from "../classify.js";
import { db } from "../db.js";
import { accountDto } from "../dto.js";
import { cleanLabel } from "../http.js";
import type { AccountViewRow, ItemRow } from "../types.js";
import { connectionInfo } from "./connections.js";

export const accounts = Router();

type Row = AccountViewRow & Pick<ItemRow, "institution" | "last_synced" | "last_error" | "identity_status">;

// Hidden accounts are left out (the Connections page lists them, from /api/status).
accounts.get("/api/accounts", (_req, res) => {
  const rows = db.prepare(`
    SELECT a.*, i.institution, i.last_synced, i.last_error, i.identity_status FROM account_view a
    JOIN items i USING (item_id) WHERE a.hidden = 0 ORDER BY i.institution, a.name`).all() as unknown as Row[];
  const conn = connectionInfo();
  res.json(rows.map((a) => ({
    ...accountDto(a),
    institution: a.institution, last_synced: a.last_synced, last_error: a.last_error, identity_status: a.identity_status,
    connection: accountConnectionLabel(a, conn.get(a.item_id)), multiple_connections: conn.get(a.item_id)?.multiple ?? false,
  })));
});

// Per-account connection label. A connection's owner-derived label lists everyone on the login, so an
// account with its own owner shows just that name; a nickname still wins.
function accountConnectionLabel(a: Row, c: { label: string; nickname: string | null } | undefined) {
  if (!c) return null;
  if (c.nickname) return c.nickname;
  return a.owner !== "Unassigned" ? a.owner : c.label;
}

// The selectable account groups, in display order.
accounts.get("/api/groups", (_req, res) => { res.json(GROUP_ORDER); });

// Manual correction of owner / group, hiding, or an investment account's register (true/false; null = automatic).
// Send null or "" to clear an owner/group override.
accounts.patch("/api/accounts/:id", (req, res) => {
  const id = String(req.params.id);
  const { owner, group, hidden, register } = req.body ?? {};
  const set = (column: string, value: string | number | null) => db.prepare(`UPDATE accounts SET ${column} = ? WHERE account_id = ?`).run(value, id);
  if (typeof hidden === "boolean") set("hidden", hidden ? 1 : 0);
  if (owner !== undefined) set("owner_override", cleanLabel(owner, 80));
  if (group !== undefined) set("group_override", cleanLabel(group, 80));
  if (register === null || typeof register === "boolean") {
    set("register_override", register == null ? null : register ? 1 : 0);
    set("inv_tx_synced", null);   // the next sync re-reads the full history instead of leaving a gap
  }
  res.json({ ok: true });
});
