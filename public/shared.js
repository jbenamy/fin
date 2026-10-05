// Helpers shared by every page (imported as an ES module).

/** querySelector shorthand (returns `any`: pages know their own markup). @returns {any} */
export const $ = (selector, root = document) => root.querySelector(selector);

/** querySelectorAll as a real array. @returns {any[]} */
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Case-insensitive, numeric-aware comparison: "Card 2" sorts before "Card 10". */
export const cmp = (a, b) => String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });

/** Sort accounts by name, then by last-4 mask. */
export const byName = (x, y) => cmp(x.name, y.name) || cmp(x.mask, y.mask);

export const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
export const usd = (n, currency = "USD") => n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency });
export const cls = (n) => (n < 0 ? "neg" : "");

/** Total of the server-supplied signed balances (credit cards and loans already negative). */
export const sum = (accounts) => accounts.reduce((total, a) => total + (a.balance ?? 0), 0);

/** Distinct owners, alphabetical, with "Unassigned" last. */
export const ownerList = (accounts) =>
  [...new Set(accounts.map((a) => a.owner))].sort((a, b) => Number(a === "Unassigned") - Number(b === "Unassigned") || cmp(a, b));

/** JSON request helper: `json` is sent as the body; a non-2xx response throws with the server's message. */
export async function api(path, { method = "GET", json } = /** @type {{ method?: string, json?: any }} */ ({})) {
  /** @type {RequestInit} */
  const init = { method };
  if (json !== undefined) { init.headers = { "content-type": "application/json" }; init.body = JSON.stringify(json); }
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

/** localStorage that never throws (private windows, blocked storage): reads fall back, writes are dropped. */
export const store = {
  get(key, fallback = null) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

/** Make a non-button element act like one: click, or Enter / Space when focused. */
export function onActivate(el, fn) {
  el.onclick = fn;
  el.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); fn(ev); } };
}

/**
 * Open a <dialog> that contains a <form>. Elements marked [data-cancel] close it; submitting runs `onSubmit`
 * (default submission is suppressed); `onClose` fires however it closes (button, Esc, or code).
 */
export function openDialog(dlg, { onSubmit, onClose } = /** @type {{ onSubmit?: (ev: Event) => any, onClose?: () => void }} */ ({})) {
  for (const button of dlg.querySelectorAll("[data-cancel]")) button.onclick = () => dlg.close();
  dlg.querySelector("form").onsubmit = (ev) => { ev.preventDefault(); return onSubmit?.(ev); };
  dlg.onclose = onClose ?? null;
  dlg.showModal();
}
