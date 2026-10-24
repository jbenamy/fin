import type { Account } from "./types";

/** Case-insensitive, numeric-aware comparison: "Card 2" sorts before "Card 10". */
export const cmp = (a: unknown, b: unknown) => String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });

/** Sort accounts by name, then by last-4 mask. */
export const byName = (x: Account, y: Account) => cmp(x.name, y.name) || cmp(x.mask, y.mask);

export const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
export const usd = (n: number | null | undefined, currency = "USD") => n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency });
/** Whole dollars for headline figures. */
export const usd0 = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const pct = (n: number | null | undefined) => n == null ? "—" : (n * 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
export const signed = (n: number | null | undefined, fmt: (n: number) => string) => n == null ? "—" : (n > 0 ? "+" : "") + fmt(n);

/** Total of the server-supplied signed balances (credit cards and loans already negative). */
export const sum = (accounts: Account[]) => accounts.reduce((total, a) => total + (a.balance ?? 0), 0);

/** Distinct owners, alphabetical, with "Unassigned" last. */
export const ownerList = (accounts: Account[]) =>
  [...new Set(accounts.map((a) => a.owner))].sort((a, b) => Number(a === "Unassigned") - Number(b === "Unassigned") || cmp(a, b));

/** `list` split into a Map by `key(item)`, keeping first-seen order. */
export function groupBy<T, K>(list: T[], key: (x: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const x of list) { const k = key(x); const g = groups.get(k); if (g) g.push(x); else groups.set(k, [x]); }
  return groups;
}

/** Accounts split by display group, in the server's group order, each list sorted by name. */
export const byGroup = (accounts: Account[]): [string, Account[]][] =>
  [...groupBy(accounts, (a) => a.group)].sort(([x, l], [y, m]) => l[0].group_rank - m[0].group_rank || cmp(x, y)).map(([g, l]) => [g, [...l].sort(byName)]);

/** True when no account in the list has a transaction register. */
export const balanceOnly = (list: Account[]) => list.every((a) => !a.register);

/** "Schwab (Alex) ··1234": where an account lives, with the connection label when one bank has several logins. */
export const where = (a: Account) => `${a.institution}${a.multiple_connections && a.connection ? ` (${a.connection})` : ""}${a.mask ? ` ··${a.mask}` : ""}`;

export function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "just now";
  if (m < 120) return m + " min ago";
  const h = Math.round(m / 60);
  return h < 48 ? h + " h ago" : Math.round(h / 24) + " d ago";
}
export const dateTime = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString() : "—";
export const shortDate = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
/** A YYYY-MM-DD date (no time zone shift). */
export const day = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Initials for an avatar: "Alex Smith & Sam Smith" -> "AS", "Charles Schwab" -> "CS". */
export const initials = (s: string) => s.split(/[\s&]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
