// "/": net worth, headline tiles, and a card for every account (owner -> account type).
import { $, $$, esc, cmp, plural, usd, sum, ownerList, byName, api, store } from "/shared.js";

let accounts = [], owner = null; // owner === null means everyone
// Zero-balance accounts are hidden by default; the choice is remembered.
let hideZero = store.get("hideZero") !== "0";

const tile = (label, value, sub) => `<div class="tile"><div class="label">${label}</div><div class="value">${usd(value)}</div><div class="sub">${sub}</div></div>`;

function card(a, multi) {
  const where = [a.institution, multi.has(a.institution) && a.connection ? a.connection : null].filter(Boolean).join(" · ") + (a.mask ? ` ··${a.mask}` : "");
  const note = a.kind === "investment" ? "balance only" : a.kind === "debt" ? "owed" :
    a.available != null && a.available !== a.balance ? `${usd(a.available)} available` : "";
  return `<a class="card" href="/accounts#${encodeURIComponent(a.account_id)}" aria-label="${esc(a.name)}, ${usd(a.balance)}">
    <div class="name">${esc(a.name)}</div><div class="where">${esc(where)}</div>
    <div class="value">${usd(a.balance)}</div>
    <div class="foot">${esc(note)}</div></a>`;
}

// One owner's section: accounts grouped by type, in the same order as the sidebar.
function ownerSection(name, mine, multi) {
  const rank = (g) => mine.find((a) => a.group === g).group_rank;
  const types = [...new Set(mine.map((a) => a.group))].sort((x, y) => rank(x) - rank(y) || cmp(x, y));
  return `<section><div class="owner"><h2>${esc(name)}</h2><span class="muted">${plural(mine.length, "account")}</span><span class="total">${usd(sum(mine))}</span></div>
    ${types.map((type) => {
      const list = mine.filter((a) => a.group === type).sort(byName);
      return `<div class="grp"><span>${esc(type)}${list.every((a) => a.kind === "investment") ? " (balance only)" : ""}</span><span class="total">${usd(sum(list))}</span></div>
        <div class="cards">${list.map((a) => card(a, multi)).join("")}</div>`;
    }).join("")}</section>`;
}

function render() {
  if (!accounts.length) {
    $("#app").innerHTML = `<div class="empty">No accounts yet. <a href="/accounts">Connect a bank</a> to get started.</div>`;
    return;
  }
  const owners = ownerList(accounts);
  const everything = owner ? accounts.filter((a) => a.owner === owner) : accounts;
  const zeros = everything.filter((a) => a.balance === 0).length;
  const shown = hideZero ? everything.filter((a) => a.balance !== 0) : everything; // net worth is unaffected: zeros add nothing
  const ofKind = (kind) => shown.filter((a) => a.kind === kind);
  const [cash, inv, debt] = [ofKind("cash"), ofKind("investment"), ofKind("debt")];
  const updated = accounts.map((a) => a.updated_at).filter(Boolean).sort().pop();
  // Institutions that appear under more than one login need the connection label to tell their cards apart.
  const multi = new Set(accounts.filter((a) => a.multiple_connections).map((a) => a.institution));

  const filters = owners.length > 1 ? `<div class="filters" role="group" aria-label="Filter by owner">
    ${[null, ...owners].map((o) => `<button class="chip" aria-pressed="${owner === o}" data-owner="${esc(o ?? "")}">${o === null ? "Everyone" : esc(o)}</button>`).join("")}</div>` : "";
  const toggle = `<label class="toggle"><span>Hide $0 accounts${hideZero && zeros ? ` (${zeros} hidden)` : ""}</span>
    <span class="switch"><input type="checkbox" role="switch" id="hidezero" ${hideZero ? "checked" : ""}><span></span></span></label>`;
  const sections = (owner ? [owner] : owners).map((o) => ({ o, mine: shown.filter((a) => a.owner === o) })).filter(({ mine }) => mine.length)
    .map(({ o, mine }) => ownerSection(o, mine, multi)).join("");

  $("#app").innerHTML = `
    <div class="hero"><div class="label">Net worth${owner ? ` · ${esc(owner)}` : ""}</div><div class="value">${usd(sum(shown))}</div>
      <div class="muted">${updated ? "Balances as of " + new Date(updated).toLocaleString() : ""}</div></div>
    <div class="tiles">
      ${tile("Cash", sum(cash), plural(cash.length, "account"))}
      ${tile("Investments", sum(inv), plural(inv.length, "account"))}
      ${tile("Owed", sum(debt), plural(debt.length, "account"))}
    </div><div class="toolbar">${filters}${toggle}</div>${sections || `<p class="muted">Every account here has a $0 balance. Turn off “Hide $0 accounts” to see them.</p>`}`;
  for (const b of $$("[data-owner]")) b.onclick = () => { owner = b.dataset.owner || null; render(); };
  $("#hidezero").onchange = (e) => { hideZero = e.target.checked; store.set("hideZero", hideZero ? "1" : "0"); render(); };
}

api("/api/accounts").then((a) => { accounts = a; render(); })
  .catch((e) => { $("#app").innerHTML = `<p class="err">Couldn't load accounts: ${esc(e.message)}</p>`; });
