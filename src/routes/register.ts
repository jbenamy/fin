import { Router, type Request } from "express";
import { db } from "../db.js";
import type { TransactionRow } from "../types.js";

export const register = Router();

// Shared by the register and payee search: which transactions are in scope (an account or an owner; never
// investment or hidden accounts).
const PAYEE = "COALESCE(NULLIF(t.merchant, ''), t.name)";
const SCOPE = `a.type != 'investment' AND a.hidden = 0 AND (? = '' OR t.account_id = ?) AND (? = '' OR a.owner = ?)`;
const scopeArgs = (req: Request) => {
  const account = String(req.query.account ?? ""), owner = String(req.query.owner ?? "");
  return [account, account, owner, owner];
};

// Keyset-paginated register: newest first, ordered by (date DESC, transaction_id ASC).
// Pass the previous response's `next` as before_date/before_id to get the following page.
// `payee` = exact payee (case-insensitive); `q` = substring match on payee or raw name.
register.get("/api/transactions", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const beforeDate = String(req.query.before_date ?? ""), beforeId = String(req.query.before_id ?? "");
  const payee = String(req.query.payee ?? ""), q = String(req.query.q ?? "");
  const rows = db.prepare(`
    SELECT t.* FROM transactions t JOIN account_view a USING (account_id)
    WHERE ${SCOPE}
      AND (? = '' OR lower(${PAYEE}) = lower(?))
      AND (? = '' OR instr(lower(${PAYEE}), lower(?)) > 0 OR instr(lower(t.name), lower(?)) > 0)
      AND (? = '' OR t.date < ? OR (t.date = ? AND t.transaction_id > ?))
    ORDER BY t.date DESC, t.transaction_id LIMIT ?`)
    .all(...scopeArgs(req), payee, payee, q, q, q, beforeDate, beforeDate, beforeDate, beforeId, limit + 1) as unknown as TransactionRow[];
  const more = rows.length > limit;
  if (more) rows.pop();
  const last = rows[rows.length - 1];
  res.json({ rows, next: more && last ? { date: last.date, id: last.transaction_id } : null });
});

// Distinct payees (with transaction counts) matching `q`, for the search dropdown. Prefix matches first, then most frequent.
register.get("/api/payees", (req, res) => {
  const q = String(req.query.q ?? "");
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);
  const where = `${SCOPE} AND (? = '' OR instr(lower(${PAYEE}), lower(?)) > 0)`;
  const args = [...scopeArgs(req), q, q];
  const payees = db.prepare(`
    SELECT MIN(${PAYEE}) AS payee, COUNT(*) AS count FROM transactions t JOIN account_view a USING (account_id)
    WHERE ${where} GROUP BY lower(${PAYEE})
    ORDER BY (instr(lower(${PAYEE}), lower(?)) = 1) DESC, count DESC, payee LIMIT ?`).all(...args, q, limit);
  const total = (db.prepare(`SELECT COUNT(DISTINCT lower(${PAYEE})) AS n FROM transactions t JOIN account_view a USING (account_id) WHERE ${where}`)
    .get(...args) as unknown as { n: number }).n;
  res.json({ payees, total });
});
