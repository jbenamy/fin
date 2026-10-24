// /accounts: sidebar + register for the selected account or owner.
import { $, $$, esc, plural, usd, cls, ownerList, api, openDialog, showError } from "/shared.js";
import { renderSidebar, setAllCollapsed } from "/js/sidebar.js";
import { mountRegister } from "/js/register.js";
import { initLink, startLink, resumeOAuth } from "/js/link.js";
import { initSync } from "/js/sync.js";
import { mountHoldings } from "/js/holdings.js";

let accounts = [], groups = [], selected = null; // selected: an account id, or "o:<owner>"

async function load() {
  [accounts, groups] = await Promise.all([api("/api/accounts"), groups.length ? groups : api("/api/groups")]);
  if (!selected && location.hash.length > 1) selected = decodeURIComponent(location.hash.slice(1)); // deep link from the dashboard
  const exists = selected && (selected.startsWith("o:") ? accounts.some((a) => "o:" + a.owner === selected) : accounts.some((a) => a.account_id === selected));
  if (!exists) { const first = ownerList(accounts)[0]; selected = first ? "o:" + first : null; }
  if (selected) { select(selected); return; } // renders the sidebar too; not awaited, as before
  renderSidebar(accounts, selected, select);
  $("#content").innerHTML = '<p class="muted">No accounts yet. Connect a bank to get started.</p>';
}

// Items linked before owner detection existed must grant Identity consent via Link update mode.
function consentBanner() {
  const items = [...new Map(accounts.filter((a) => a.identity_status === "needs_consent").map((a) => [a.item_id, a.institution]))];
  return items.map(([id, name]) => `<div class="banner">Owner detection needs permission for <b>${esc(name)}</b>.
    <button class="sm" data-consent="${esc(id)}">Enable</button></div>`).join("");
}

function wireMain(acct) {
  if (acct) $("#edit").onclick = () => editAccount(acct);
  for (const button of $$("[data-consent]")) button.onclick = () => startLink(button.dataset.consent);
}

const headline = (a) => `<h1>${esc(a.name)} <button class="ghost sm" id="edit">Edit</button></h1>
  <p class="muted">${esc(a.institution)} · ${esc(a.owner)} · ${esc(a.group)}</p>`;

// Market value and holdings of an investment account: the whole page when it is balance-only, above the register otherwise.
const marketValue = (a, note = "") => `<p style="font-size:28px" class="num">${usd(a.balance)}</p>
  <p class="muted">Current value as of ${new Date(a.updated_at).toLocaleString()}.${note}</p><div id="holdings"></div>`;

function renderInvestment(acct) {
  $("#content").innerHTML = consentBanner() + headline(acct) +
    marketValue(acct, " Transaction register is not shown for brokerage accounts; turn it on under Edit for a cash management account.");
  wireMain(acct);
  mountHoldings(acct.account_id);
}

async function renderRegister(id, acct, owner) {
  const names = Object.fromEntries(accounts.map((a) => [a.account_id, a.name]));
  const errs = [...new Set(accounts.filter((a) => a.last_error).map((a) => a.institution + ": " + a.last_error))];
  const synced = accounts.map((a) => a.last_synced).filter(Boolean).sort().pop();
  const row = (t) => { const amt = -t.amount; /* Plaid: positive = money out */
    return `<tr class="${t.pending ? "pending" : ""}"><td>${t.date}</td>${acct ? "" : `<td>${esc(names[t.account_id])}</td>`}
      <td>${esc(t.merchant || t.name)}${t.pending ? " (pending)" : ""}</td><td class="muted">${esc((t.category || "").replace(/_/g, " ").toLowerCase())}</td>
      <td class="num ${cls(amt)}">${usd(amt)}</td></tr>`; };
  $("#content").innerHTML = consentBanner() + (acct ? headline(acct) + (acct.kind === "investment" ? marketValue(acct) : "") : `<h1>${esc(owner)}</h1>
      <p class="muted">${plural(accounts.filter((a) => a.owner === owner).length, "account")}</p>`) + `
    <p class="muted">${synced ? "Last synced " + new Date(synced).toLocaleString() : "Not synced yet"}</p>
    ${errs.map((e) => `<p class="err">${esc(e)}</p>`).join("")}
    <div class="searchrow"><div class="search" style="margin:0;flex:1;min-width:220px">
      <input id="payeeq" role="combobox" aria-expanded="false" aria-controls="payeelist" aria-autocomplete="list" autocomplete="off" placeholder="Search payee…">
      <div class="plist" id="payeelist" role="listbox" hidden></div></div><div id="filterchip"></div></div>
    <table><thead><tr><th>Date</th>${acct ? "" : "<th>Account</th>"}<th>Payee</th><th>Category</th><th class="num">Amount</th></tr></thead>
    <tbody id="txbody"></tbody></table>
    <div id="txmore" class="muted" style="text-align:center;padding:14px;font-size:12px"></div>`;
  wireMain(acct);
  if (acct?.kind === "investment") mountHoldings(acct.account_id);
  await mountRegister({ id, row, columns: acct ? 4 : 5 });
}

async function select(id) {
  selected = id; renderSidebar(accounts, selected, select);
  const owner = id.startsWith("o:") ? id.slice(2) : null;
  const acct = owner === null ? accounts.find((a) => a.account_id === id) : undefined;
  if (acct && !acct.register) renderInvestment(acct); else await renderRegister(id, acct, owner);
}

// Edit dialog: a blank owner / "Automatic" group or register clears the manual override.
// Only investment accounts offer the register choice; every other account always has one.
function editAccount(a) {
  const dlg = $("#editdlg"), owner = $("#edowner"), group = $("#edgroup"), reg = $("#edreg"), err = $("#ederr");
  const investment = a.kind === "investment";
  $("#edtitle").textContent = a.name;
  owner.value = a.owner_override ?? "";
  owner.placeholder = a.owner_detected ? `Detected: ${a.owner_detected}` : "No owner detected";
  $("#edhint").textContent = "Leave blank to use the detected owner.";
  $("#owners").innerHTML = ownerList(accounts).filter((o) => o !== "Unassigned").map((o) => `<option value="${esc(o)}">`).join("");
  group.innerHTML = `<option value="">Automatic</option>` + groups.map((g) => `<option ${a.group_override === g ? "selected" : ""}>${g}</option>`).join("");
  $("#edreglabel").hidden = $("#edreghint").hidden = !investment;
  reg.value = String(a.register_override ?? "");
  reg.options[0].textContent = `Automatic (${a.register_auto ? "shown" : "balance only"})`;
  showError(err, null);
  openDialog(dlg, {
    async onSubmit() {
      const save = $("#edsave"); save.disabled = true;
      try {
        await api("/api/accounts/" + encodeURIComponent(a.account_id), { method: "PATCH", json: {
          owner: owner.value, group: group.value,
          ...(investment ? { register: reg.value === "" ? null : reg.value === "true" } : {}),
        } });
        dlg.close(); await load();
      } catch (e) { showError(err, e); }
      save.disabled = false;
    },
  });
  owner.focus();
}

initLink(load);
initSync(load);
$("#expandall").onclick = () => setAllCollapsed(false);
$("#collapseall").onclick = () => setAllCollapsed(true);
load();
resumeOAuth();
