// The accounts sidebar: owners -> account types -> accounts, with collapse state that survives reloads.
import { $, $$, esc, cmp, plural, usd, cls, sum, ownerList, byName, store, onActivate } from "/shared.js";

let collapsed = new Set();
try { collapsed = new Set(JSON.parse(store.get("collapsed", "[]"))); } catch {}
const save = () => store.set("collapsed", JSON.stringify([...collapsed]));

let ctx = { accounts: [], selected: null, onSelect: (_id) => {} }; // last render's inputs, so collapse toggles can re-render

const icon = (paths) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICON = { down: icon('<path d="m6 9 6 6 6-6"/>'), right: icon('<path d="m9 6 6 6-6 6"/>') }; // expanded / collapsed
const chev = (key) => `<span class="chev">${collapsed.has(key) ? ICON.right : ICON.down}</span>`;
const count = (n) => `<span class="count">${n}</span>`;

const where = (a) => `${a.institution}${a.multiple_connections && a.connection ? ` (${a.connection})` : ""}${a.mask ? ` ··${a.mask}` : ""}`;

// Hover text: the full name and details that the narrow column wraps or omits.
const accountTip = (a) => [a.name, where(a), `${a.group} · ${a.owner}`,
  usd(a.balance) + (a.kind === "cash" && a.available != null && a.available !== a.balance ? ` (${usd(a.available)} available)` : "")].join("\n");

const accountRow = (a) => `<div class="acct ${ctx.selected === a.account_id ? "sel" : ""}" data-id="${esc(a.account_id)}" title="${esc(accountTip(a))}">
    <span>${esc(a.name)}<small>${esc(where(a))}</small></span>
    <span class="num ${cls(a.balance)}">${usd(a.balance)}</span></div>`;

function ownerBlock(owner) {
  const mine = ctx.accounts.filter((a) => a.owner === owner), key = "o:" + owner, isCollapsed = collapsed.has(key);
  const rank = (g) => mine.find((a) => a.group === g).group_rank;
  const types = [...new Set(mine.map((a) => a.group))].sort((a, b) => rank(a) - rank(b) || cmp(a, b));
  let html = `<div class="owner ${ctx.selected === key ? "sel" : ""}" role="button" tabindex="0" data-owner="${esc(key)}" title="${esc(owner)}\n${plural(mine.length, "account")} · ${usd(sum(mine))}\nClick to show all their transactions">
    <span class="otoggle" role="button" tabindex="0" aria-label="${isCollapsed ? "Expand" : "Collapse"} ${esc(owner)}" aria-expanded="${!isCollapsed}" data-toggle="${esc(key)}">${chev(key)}</span>
    <span class="oname">${esc(owner)}${isCollapsed ? count(mine.length) : ""}</span><span class="num ${cls(sum(mine))}">${usd(sum(mine))}</span></div>`;
  if (isCollapsed) return html;
  for (const type of types) {
    const list = mine.filter((a) => a.group === type).sort(byName), gk = `g:${owner}|${type}`, open = !collapsed.has(gk);
    html += `<div class="grp" role="button" tabindex="0" aria-expanded="${open}" data-toggle="${esc(gk)}" title="${esc(`${type}\n${plural(list.length, "account")} · ${usd(sum(list))}\nClick to ${open ? "collapse" : "expand"}`)}">
      <span>${chev(gk)}${esc(type)}${list.every((a) => a.kind === "investment") ? " (balance only)" : ""}${open ? "" : count(list.length)}</span><span class="num">${usd(sum(list))}</span></div>`;
    if (open) html += list.map(accountRow).join("");
  }
  return html;
}

/** Render the sidebar. `onSelect` receives an account id or "o:<owner>". */
export function renderSidebar(accounts, selected, onSelect) {
  ctx = { accounts, selected, onSelect };
  $("#accounts").innerHTML = ownerList(accounts).map(ownerBlock).join("");
  for (const el of $$(".acct")) el.onclick = () => onSelect(el.dataset.id);
  // The chevron / type header toggles collapse; clicking the owner row itself shows that owner's transactions.
  for (const el of $$("[data-toggle]")) onActivate(el, (ev) => { ev.stopPropagation(); toggle(el.dataset.toggle); });
  for (const el of $$("[data-owner]")) onActivate(el, () => onSelect(el.dataset.owner));
}

const rerender = () => renderSidebar(ctx.accounts, ctx.selected, ctx.onSelect);

function toggle(key) { collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key); save(); rerender(); }

/** Collapse every owner, or expand everything. */
export function setAllCollapsed(collapse) {
  collapsed = new Set(collapse ? ctx.accounts.map((a) => "o:" + a.owner) : []);
  save(); rerender();
}
