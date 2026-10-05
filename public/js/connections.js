// /connections: linked banks grouped by institution, with health, per-account owner and visibility, duplicates, rename and unlink.
import { $, $$, esc, cmp, plural, usd, byName, api, openDialog } from "/shared.js";

const STALE_HOURS = 36; // a daily sync should never be older than this
let items = [];

// ---- formatting ---------------------------------------------------------------------------------------------------
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "just now";
  if (m < 120) return m + " min ago";
  const h = Math.round(m / 60);
  return h < 48 ? h + " h ago" : Math.round(h / 24) + " d ago";
}
const when = (iso) => iso ? `${new Date(iso).toLocaleString()} <span class="muted">(${ago(iso)})</span>` : "—";
const short = (id) => "…" + String(id).slice(-6);

function health(i) {
  if (i.last_error || i.plaid?.error || i.plaid_error) return ["bad", "Error"];
  if (i.identity_status === "needs_consent") return ["warn", "Needs permission"];
  if (!i.last_synced) return ["warn", "Never synced"];
  if (Date.now() - new Date(i.last_synced).getTime() > STALE_HOURS * 3600e3) return ["warn", "Stale"];
  return ["ok", "Healthy"];
}

// ---- duplicate accounts -------------------------------------------------------------------------------------------
function renderDups({ accounts: groups, connections: conns }) {
  if (!groups.length && !conns.length) {
    $("#dups").innerHTML = `<div class="card"><div class="head"><h2>Duplicate accounts</h2><span class="pill ok">None found</span></div>
      <p class="muted" style="margin:8px 0 0;font-size:13px">No account appears through more than one connection.</p></div>`;
    return;
  }
  $("#dups").innerHTML = `<div class="card"><div class="head"><h2>Duplicate accounts</h2><span class="pill warn">${groups.length + conns.length} found</span></div>
    <p class="muted" style="margin:8px 0 0;font-size:13px">The same real account is reachable through more than one linked connection, for example when two people each link the same joint account.
    Balances and transactions for these are counted more than once in owner totals and "All transactions".</p>
    ${conns.map((c) => `<div class="err" style="color:var(--warn)">${esc(c.institution)}: ${c.item_ids.length} connections (${c.item_ids.map(short).join(", ")}) cover the same accounts. Each one is a separate Plaid Item, so you're likely paying for both.</div>`).join("")}
    ${groups.length ? `<table><thead><tr><th>Account</th><th>Seen under</th><th class="num">Balance</th><th>Match</th></tr></thead><tbody>
      ${[...groups].sort((x, y) => cmp(x.institution, y.institution) || cmp(x.mask, y.mask)).map((g) => `<tr><td>${esc(g.institution)}<br><span class="muted">${esc(g.subtype || g.type)} ··${esc(g.mask)}</span></td>
        <td>${[...g.members].sort((x, y) => cmp(x.owner, y.owner)).map((m) => `${esc(m.owner)} <span class="muted">· ${esc(m.name)} · connection ${esc(short(m.item_id))}</span>`).join("<br>")}</td>
        <td class="num">${g.members.map((m) => usd(m.balance)).join("<br>")}</td>
        <td><span class="pill ${g.confidence === "high" ? "bad" : "warn"}">${g.confidence === "high" ? "Same balance" : "Balances differ"}</span></td></tr>`).join("")}
    </tbody></table>` : ""}</div>`;
}
const loadDups = () => api("/api/duplicates").then(renderDups).catch(() => {});

// ---- connection cards ---------------------------------------------------------------------------------------------
// A manual owner that no other account uses still has to appear in the dropdown.
function ownerSelect(a, owners) {
  const opts = [`<option value="">Detected: ${esc(a.owner_detected ?? "none")}</option>`,
    ...owners.map((o) => `<option value="${esc(o)}" ${a.owner_override === o ? "selected" : ""}>${esc(o)}</option>`)];
  if (a.owner_override && !owners.includes(a.owner_override)) opts.splice(1, 0, `<option value="${esc(a.owner_override)}" selected>${esc(a.owner_override)}</option>`);
  opts.push('<option value="__new__">New owner…</option>');
  return `<select class="ownersel" data-owner-acct="${esc(a.account_id)}" data-prev="${esc(a.owner_override ?? "")}" aria-label="Owner of ${esc(a.name)}">${opts.join("")}</select>`;
}

function accountRow(a, owners) {
  return `<tr class="${a.hidden ? "off" : ""}">
    <td class="c keep"><label class="switch" title="${a.hidden ? "Hidden" : "Shown"} in the accounts view"><input type="checkbox" role="switch" data-acct="${esc(a.account_id)}" ${a.hidden ? "" : "checked"} aria-label="Show ${esc(a.name)}"><span></span></label></td>
    <td>${esc(a.name)}${a.mask ? " ··" + esc(a.mask) : ""}${a.hidden ? ' <span class="muted keep">(hidden)</span>' : ""}</td>
    <td class="keep">${ownerSelect(a, owners)}</td><td>${esc(a.group)}</td>
    <td class="num">${usd(a.balance, a.currency)}</td><td>${when(a.updated_at)}</td></tr>`;
}

function card(i, owners) {
  const [state, label] = health(i), p = i.plaid;
  const row = (term, value) => `<dt>${term}</dt><dd>${value}</dd>`;
  const failedAfterSuccess = p?.transactions_last_failure && p.transactions_last_failure > (p.transactions_last_success || "");
  return `<div class="card">
    <div class="head"><h2>${esc(i.label)}</h2>
      <button class="ghost sm" data-rename="${esc(i.item_id)}">Rename</button>
      <button class="ghost sm danger" data-unlink="${esc(i.item_id)}">Unlink</button><span class="pill ${state}">${label}</span></div>
    <dl>
      ${row("Connection", `${esc(i.suffix ? "…" + i.suffix : "")}${i.owners.length ? ` · ${esc([...i.owners].sort(cmp).join(", "))}` : ""}${i.created_at ? ` · linked ${new Date(i.created_at).toLocaleDateString()}` : ""}`)}
      ${row("Last sync (this app)", when(i.last_synced))}
      ${p ? row("Transactions updated (Plaid)", when(p.transactions_last_success)) : ""}
      ${p?.investments_last_success ? row("Investments updated (Plaid)", when(p.investments_last_success)) : ""}
      ${p?.consent_expiration_time ? row("Consent expires", when(p.consent_expiration_time)) : ""}
      ${p ? row("Products", esc((p.consented_products || []).join(", ") || "—")) : ""}
      ${row("Owner detection", esc(i.identity_status ?? "not tried yet"))}
    </dl>
    ${i.last_error ? `<div class="err">Sync error: ${esc(i.last_error)}</div>` : ""}
    ${p?.error ? `<div class="err">Plaid item error: ${esc(p.error)}</div>` : ""}
    ${failedAfterSuccess ? `<div class="err">Last transactions update failed ${when(p.transactions_last_failure)}</div>` : ""}
    ${i.plaid_error ? `<div class="err">Could not reach Plaid for this item: ${esc(i.plaid_error)}</div>` : ""}
    <table><thead><tr><th class="c">Show</th><th>Account</th><th>Owner</th><th>Type</th><th class="num">Balance</th><th>Balance as of</th></tr></thead><tbody>
    ${[...i.accounts].sort(byName).map((a) => accountRow(a, owners)).join("")}
    </tbody></table></div>`;
}

// One institution: a header with rolled-up counts and the worst health, then its connections.
function institution(name, list, owners) {
  const rank = { ok: 0, warn: 1, bad: 2 };
  list.sort((a, b) => cmp(a.label, b.label));
  const worst = list.map(health).reduce((w, h) => (rank[h[0]] > rank[w[0]] ? h : w), ["ok", "Healthy"]);
  const accts = list.reduce((n, i) => n + i.accounts.length, 0);
  return `<section class="inst">
    <div class="insthead"><h2>${esc(name)}</h2><span class="muted">${plural(list.length, "connection")} · ${plural(accts, "account")}</span>
      <span class="pill ${worst[0]}">${worst[1]}</span></div>
    <div class="instbody">${list.map((i) => card(i, owners)).join("")}</div></section>`;
}

function render() {
  const fetched = items.map((i) => i.plaid?.fetched_at).filter(Boolean).sort()[0];
  $("#sub").textContent = `${plural(items.length, "linked connection")}${fetched ? " · Plaid status as of " + new Date(fetched).toLocaleTimeString() : ""}`;
  const owners = [...new Set(items.flatMap((i) => i.accounts.map((a) => a.owner)).filter((o) => o !== "Unassigned"))].sort(cmp);
  const byInstitution = new Map();
  for (const i of items) (byInstitution.get(i.institution) ?? byInstitution.set(i.institution, []).get(i.institution)).push(i);
  $("#items").innerHTML = [...byInstitution].sort(([a], [b]) => cmp(a, b)).map(([name, list]) => institution(name, list, owners)).join("")
    || '<p class="muted">No banks linked yet.</p>';
  for (const b of $$("[data-rename]")) b.onclick = () => rename(items.find((i) => i.item_id === b.dataset.rename));
  for (const b of $$("[data-unlink]")) b.onclick = () => unlink(items.find((i) => i.item_id === b.dataset.unlink));
  for (const box of $$("[data-acct]")) box.onchange = () => setHidden(box);
  for (const sel of $$("[data-owner-acct]")) sel.onchange = () => reassign(sel);
}

// Plaid's connection status is cached server-side for a few minutes; `force` asks for a fresh copy.
async function load(force = false) {
  loadDups();
  try { items = await api("/api/status" + (force ? "?refresh=1" : "")); } catch (e) { $("#sub").textContent = e.message; return; }
  render();
}

// ---- actions ------------------------------------------------------------------------------------------------------
// Reassign an account to a different owner. Only the account's owner changes; it stays on the same Plaid
// connection, so syncing, billing and the other accounts under that login are unaffected.
async function saveOwner(accountId, owner) {
  await api("/api/accounts/" + encodeURIComponent(accountId), { method: "PATCH", json: { owner } });
  await load(); // connection labels and the duplicate check depend on owners
}

async function reassign(sel) {
  const id = sel.dataset.ownerAcct;
  const fail = (e) => { alert("Could not update: " + e.message); sel.value = sel.dataset.prev; };
  if (sel.value !== "__new__") return saveOwner(id, sel.value).catch(fail);
  const dlg = $("#ownerdlg"), input = $("#ownername");
  let saved = false;
  input.value = "";
  openDialog(dlg, {
    onSubmit: async () => {
      const name = input.value.trim();
      if (!name) return;
      saved = true; dlg.close();
      try { await saveOwner(id, name); } catch (e) { fail(e); }
    },
    onClose: () => { if (!saved) sel.value = sel.dataset.prev; }, // cancelled: put the dropdown back
  });
  input.focus();
}

// Hidden accounts stay synced but are left out of the accounts view, totals, register and duplicate checks.
async function setHidden(box) {
  const hidden = !box.checked;
  box.disabled = true;
  try {
    await api("/api/accounts/" + encodeURIComponent(box.dataset.acct), { method: "PATCH", json: { hidden } });
    for (const i of items) for (const a of i.accounts) if (a.account_id === box.dataset.acct) a.hidden = hidden;
    render(); loadDups();
  } catch (e) { box.checked = !box.checked; box.disabled = false; alert("Could not update: " + e.message); }
}

function rename(i) {
  const dlg = $("#renamedlg"), input = $("#rnname");
  $("#rntitle").textContent = i.institution; input.value = i.nickname ?? "";
  input.placeholder = i.owners.length ? i.owners.join(", ") : "e.g. Alex's Schwab";
  openDialog(dlg, {
    async onSubmit() {
      try { await api("/api/items/" + encodeURIComponent(i.item_id), { method: "PATCH", json: { nickname: input.value } }); dlg.close(); load(); }
      catch (e) { alert("Could not rename: " + e.message); }
    },
  });
  input.focus();
}

function unlink(i) {
  const dlg = $("#unlinkdlg"), err = $("#ulerr"), go = $("#ulgo");
  $("#ultitle").textContent = `Unlink ${i.institution} · ${i.label}?`;
  $("#ulbody").innerHTML = `This revokes the connection at Plaid, which ends access and billing for it, and permanently deletes its
    <b>${plural(i.accounts.length, "account")}</b> and <b>${plural(i.transaction_count, "stored transaction")}</b> from this app.
    It can't be undone. To bring it back you'd link the bank again and log in at the bank.`;
  err.hidden = true; go.disabled = false; go.textContent = "Unlink";
  openDialog(dlg, {
    async onSubmit() {
      go.disabled = true; go.textContent = "Unlinking…";
      try { await api("/api/items/" + encodeURIComponent(i.item_id), { method: "DELETE" }); dlg.close(); load(); }
      catch (e) { err.textContent = e.message; err.hidden = false; go.disabled = false; go.textContent = "Unlink"; }
    },
  });
}

$("#refresh").onclick = async () => { const b = $("#refresh"); b.disabled = true; await load(true); b.disabled = false; };
load();
