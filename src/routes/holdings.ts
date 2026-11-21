import { Router } from "express";
import { ASSET_CLASSES, assetClass } from "../classify.js";
import { db } from "../db.js";
import { type Activity, periods, series, type Snapshot } from "../performance.js";
import type { HoldingRow } from "../types.js";

export const holdings = Router();

/** A price this many days older than today is flagged as stale. */
const STALE_DAYS = 5;

// One investment account's positions (largest first) and its allocation by asset class. `slot` is the class's
// fixed chart color (its index in ASSET_CLASSES). `synced` is false until a sync has stored holdings for it.
holdings.get("/api/holdings", (req, res) => {
  const account = String(req.query.account ?? "");
  const rows = db.prepare("SELECT * FROM holdings WHERE account_id = ? ORDER BY value DESC").all(account) as unknown as HoldingRow[];
  const synced = rows.length > 0 || !!db.prepare("SELECT 1 FROM holding_history WHERE account_id = ? LIMIT 1").get(account);
  const total = rows.reduce((t, h) => t + h.value, 0);
  const pct = (v: number) => (total > 0 ? v / total : null);
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const positions = rows.map((h) => {
    const gain = h.cost_basis == null ? null : h.value - h.cost_basis;
    return {
      name: h.name, ticker: h.ticker, class: assetClass(h.security_type, !!h.is_cash),
      quantity: h.quantity, price: h.price, price_as_of: h.price_as_of, stale: !!h.price_as_of && h.price_as_of < staleBefore,
      value: h.value, pct: pct(h.value), cost_basis: h.cost_basis, gain, gain_pct: gain != null && h.cost_basis ? gain / Math.abs(h.cost_basis) : null,
      vested_value: h.vested_value, currency: h.currency ?? "USD",
    };
  });
  const byClass = new Map<string, number>();
  for (const p of positions) byClass.set(p.class, (byClass.get(p.class) ?? 0) + p.value);
  const allocation = ASSET_CLASSES.flatMap((c, slot) => {
    const value = byClass.get(c);
    return value === undefined ? [] : [{ class: c, slot, value, pct: pct(value) }];
  });
  res.json({ synced, holdings: positions, allocation });
});

// An investment account's value over time against the money put in (series), and gain / return per period.
// Both start at the first daily snapshot Fin took: Plaid has no history. `activity_synced` is null until a sync has
// read the account's investment transactions (without them, contributions would count as gains, so no periods).
holdings.get("/api/performance", (req, res) => {
  const account = String(req.query.account ?? "");
  const acct = db.prepare("SELECT inv_activity_synced FROM accounts WHERE account_id = ? AND type = 'investment'").get(account) as
    { inv_activity_synced: string | null } | undefined;
  if (!acct) return void res.status(404).json({ error: "unknown investment account" });
  const snaps = db.prepare("SELECT date, balance AS value FROM balance_history WHERE account_id = ? AND balance IS NOT NULL ORDER BY date")
    .all(account) as unknown as Snapshot[];
  const activity = db.prepare("SELECT date, type, subtype, amount, quantity, price FROM investment_transactions WHERE account_id = ? ORDER BY date")
    .all(account) as unknown as Activity[];
  const synced = acct.inv_activity_synced;
  res.json({ activity_synced: synced, series: series(snaps, activity), periods: synced ? periods(snaps, activity) : [] });
});
