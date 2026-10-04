// Helpers shared by every page (imported as an ES module).
export const $ = (selector, root = document) => root.querySelector(selector);

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Case-insensitive, numeric-aware comparison: "Card 2" sorts before "Card 10". */
export const cmp = (a, b) => String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const usd = (n, currency = "USD") => n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency });
export const cls = (n) => (n < 0 ? "neg" : "");

/** Total of the server-supplied signed balances (credit cards and loans already negative). */
export const sum = (accounts) => accounts.reduce((total, a) => total + (a.balance ?? 0), 0);

/** Distinct owners, alphabetical, with "Unassigned" last. */
export const ownerList = (accounts) =>
  [...new Set(accounts.map((a) => a.owner))].sort((a, b) => (a === "Unassigned") - (b === "Unassigned") || cmp(a, b));

/** JSON request helper: `json` is sent as the body; a non-2xx response throws with the server's message. */
export async function api(path, { method = "GET", json } = {}) {
  const init = { method };
  if (json !== undefined) { init.headers = { "content-type": "application/json" }; init.body = JSON.stringify(json); }
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}
