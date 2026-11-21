import { daysBetween, isoDate } from "./dates.js";

// Investment performance from Fin's own snapshots: Plaid has no historical balances, so values come from
// balance_history (one row per sync day) and money added or withdrawn from investment_transactions.

/** One stored activity row, as far as performance needs it. Plaid's signs: amount positive = cash out of the account. */
export interface Activity { date: string; type: string | null; subtype: string | null; amount: number; quantity: number | null; price: number | null }
export interface Snapshot { date: string; value: number }

const INCOME = new Set([
  "dividend", "qualified dividend", "non-qualified dividend", "interest", "long-term capital gain", "short-term capital gain",
]);
const CASH_FLOWS = new Set(["deposit", "withdrawal", "contribution", "transfer"]);

/**
 * Money moved into (+) or out of (−) the account from outside, or null for activity inside it (trades, dividends,
 * fees). Cash moves are signed by `amount`; assets moved in kind carry no cash amount, so they count at quantity × price.
 * Brokers record retirement contributions as a buy (subtype "contribution") and payouts as a sell ("distribution").
 */
export function externalFlow(t: Activity): number | null {
  const sub = t.subtype ?? "", inKind = () => (t.quantity ?? 0) * (t.price ?? 0);
  if (t.type === "cancel") return null;
  if (t.type === "buy" && sub === "contribution") return Math.abs(t.amount || inKind());
  if (t.type === "sell" && sub === "distribution") return -Math.abs(t.amount || inKind());
  if (t.type === "buy" || t.type === "sell" || !CASH_FLOWS.has(sub)) return null;
  return t.amount !== 0 ? -t.amount : inKind();
}

/** Dividends, interest and capital-gain distributions paid in cash (a component of the gain, not added to it). */
export const income = (t: Activity) => (t.type !== "cancel" && INCOME.has(t.subtype ?? "") ? -t.amount : 0);
/** Fees charged (negative; a component of the gain). */
export const fee = (t: Activity) => (t.type === "fee" ? -t.amount : 0);

export interface Period {
  key: string; label: string;
  start: string; end: string; start_value: number; end_value: number;
  /** Money added minus money withdrawn. */
  net_contributions: number;
  /** end − start − net contributions: what the market (and dividends, minus fees) did. */
  gain: number;
  income: number; fees: number;
  /** Modified Dietz return (contributions weighted by the share of the period they were invested); null when undefined. */
  return: number | null;
}

const PERIODS: { key: string; label: string; start: (today: Date) => Date | null }[] = [
  { key: "1m", label: "1M", start: (d) => addMonths(d, -1) },
  { key: "3m", label: "3M", start: (d) => addMonths(d, -3) },
  { key: "ytd", label: "YTD", start: (d) => new Date(Date.UTC(d.getUTCFullYear(), 0, 1)) },
  { key: "1y", label: "1Y", start: (d) => addMonths(d, -12) },
  { key: "all", label: "All", start: () => null },
];
function addMonths(d: Date, n: number) { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; }

/**
 * Gain and return for each standard period that the snapshots fully cover ("All" always, from the first snapshot).
 * A period starts at the last snapshot on or before its start date. Activity dated after the start snapshot's day
 * and up to the end counts (a snapshot is taken during the day, after that day's activity is usually posted).
 */
export function periods(snaps: Snapshot[], activity: Activity[], today = new Date()): Period[] {
  if (snaps.length < 2) return [];
  const last = snaps[snaps.length - 1]!, first = snaps[0]!;
  const out: Period[] = [];
  for (const p of PERIODS) {
    const want = p.start(today);
    if (want && isoDate(want) < first.date) continue;
    const s = want ? snaps.filter((x) => x.date <= isoDate(want)).pop()! : first;
    if (s.date >= last.date) continue;
    out.push({ key: p.key, label: p.label, ...measure(s, last, activity) });
  }
  return out;
}

function measure(s: Snapshot, e: Snapshot, activity: Activity[]) {
  let net = 0, weighted = 0, inc = 0, fees = 0;
  const span = daysBetween(s.date, e.date);
  for (const t of activity) {
    if (t.date <= s.date || t.date > e.date) continue;
    const f = externalFlow(t);
    if (f != null) { net += f; weighted += f * (daysBetween(t.date, e.date) / span); }
    inc += income(t); fees += fee(t);
  }
  const gain = e.value - s.value - net, base = s.value + weighted;
  return {
    start: s.date, end: e.date, start_value: s.value, end_value: e.value, net_contributions: net, gain,
    income: inc, fees, return: base > 0 ? gain / base : null,
  };
}

/** Value and "net invested" (first value plus money added since) per snapshot day; the gap between them is the gain. */
export function series(snaps: Snapshot[], activity: Activity[]) {
  const flows = activity.flatMap((t) => { const f = externalFlow(t); return f == null ? [] : [{ date: t.date, f }]; })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = snaps[0];
  let invested = first?.value ?? 0, i = 0;
  while (first && i < flows.length && flows[i]!.date <= first.date) i++;
  return snaps.map((s) => {
    for (; i < flows.length && flows[i]!.date <= s.date; i++) invested += flows[i]!.f;
    return { date: s.date, value: s.value, invested };
  });
}
