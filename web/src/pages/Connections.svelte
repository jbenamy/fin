<!-- /connections: linked banks grouped by institution, with health, per-account owner and visibility, duplicates, rename and unlink. -->
<script lang="ts">
  import { Copy, Pencil, Plug, RefreshCw, Unlink } from "@lucide/svelte";
  import Avatar from "../components/Avatar.svelte";
  import Dialog from "../components/Dialog.svelte";
  import Empty from "../components/Empty.svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import Pill from "../components/Pill.svelte";
  import Switch from "../components/Switch.svelte";
  import { api, message } from "../lib/api";
  import { changed, data, updateAccount } from "../lib/data.svelte";
  import { ago, byName, cmp, groupBy, ownerList, plural, usd } from "../lib/format";
  import { startLink } from "../lib/link.svelte";
  import type { Account, Duplicates, Item } from "../lib/types";

  const STALE_HOURS = 36; // a daily sync should never be older than this
  type Tone = "ok" | "warn" | "bad";
  const RANK: Record<Tone, number> = { ok: 0, warn: 1, bad: 2 };

  let items = $state<Item[]>([]), dups = $state<Duplicates | null>(null), loaded = $state(false), error = $state(""), refreshing = $state(false);

  // Plaid's connection status is cached server-side for a few minutes; `force` asks for a fresh copy.
  async function load(force = false) {
    api<Duplicates>("/api/duplicates").then((d) => (dups = d)).catch(() => {});
    try { items = await api<Item[]>("/api/status" + (force ? "?refresh=1" : "")); error = ""; } catch (e) { error = message(e); }
    loaded = true;
  }
  // Reload whenever a sync, a new connection or an edit elsewhere changes the data.
  $effect(() => { void data.version; load(); });

  const short = (id: string) => "…" + id.slice(-6);
  const fetched = $derived(items.map((i) => i.plaid?.fetched_at).filter(Boolean).sort()[0]);
  const owners = $derived(ownerList(items.flatMap((i) => i.accounts)).filter((o) => o !== "Unassigned"));
  const institutions = $derived([...groupBy(items, (i) => i.institution)].sort(([a], [b]) => cmp(a, b))
    .map(([name, list]) => ({ name, list: [...list].sort((a, b) => cmp(a.label, b.label)) })));
  const dupCount = $derived(dups ? dups.accounts.length + dups.connections.length : 0);

  function health(i: Item): [Tone, string] {
    if (i.last_error || i.plaid?.error || i.plaid_error) return ["bad", "Error"];
    if (i.identity_status === "needs_consent") return ["warn", "Needs permission"];
    if (!i.last_synced) return ["warn", "Never synced"];
    if (Date.now() - new Date(i.last_synced).getTime() > STALE_HOURS * 3600e3) return ["warn", "Stale"];
    return ["ok", "Healthy"];
  }
  const worst = (list: Item[]) => list.map(health).reduce((w, h) => (RANK[h[0]] > RANK[w[0]] ? h : w), ["ok", "Healthy"] as [Tone, string]);
  const failedAfterSuccess = (i: Item) => !!i.plaid?.transactions_last_failure && i.plaid.transactions_last_failure > (i.plaid.transactions_last_success || "");

  // Owner dropdown: a manual owner that no other account uses still has to appear.
  const ownerOptions = (a: Account) => a.owner_override && !owners.includes(a.owner_override) ? [a.owner_override, ...owners] : owners;

  // Saves an account change (updateAccount reloads, since connection labels and duplicates depend on owners and
  // visibility). Resolves false, after telling the user, when it didn't save, so the control can flip back.
  const update = (id: string, fields: Record<string, unknown>) =>
    updateAccount(id, fields).then(() => true, (e) => { alert("Could not update: " + message(e)); return false; });

  // Reassign an account to a different owner. Only the account's owner changes; it stays on the same Plaid
  // connection, so syncing, billing and the other accounts under that login are unaffected.
  let newOwnerFor = $state<Account | null>(null), newOwnerOpen = $state(false), newOwner = $state("");
  async function pickOwner(a: Account, sel: HTMLSelectElement) {
    const saved = a.owner_override ?? "";
    if (sel.value === "__new__") { sel.value = saved; newOwnerFor = a; newOwner = ""; newOwnerOpen = true; } // the dialog saves the name
    else if (!(await update(a.account_id, { owner: sel.value }))) sel.value = saved;
  }

  // Hidden accounts stay synced but are left out of the accounts view, totals, register and duplicate checks.
  const setShown = (a: Account, shown: boolean) => update(a.account_id, { hidden: !shown });

  let renaming = $state<Item | null>(null), renameOpen = $state(false), nickname = $state("");
  async function rename() {
    try { await api("/api/items/" + encodeURIComponent(renaming!.item_id), { method: "PATCH", json: { nickname } }); renameOpen = false; await changed(); }
    catch (e) { alert("Could not rename: " + message(e)); }
  }

  let unlinking = $state<Item | null>(null), unlinkOpen = $state(false), unlinkErr = $state(""), unlinkBusy = $state(false);
  async function unlink() {
    unlinkBusy = true; unlinkErr = "";
    try { await api("/api/items/" + encodeURIComponent(unlinking!.item_id), { method: "DELETE" }); unlinkOpen = false; await changed(); }
    catch (e) { unlinkErr = message(e); }
    unlinkBusy = false;
  }

  async function refresh() { refreshing = true; await load(true); refreshing = false; }
  const when = (iso: string | null | undefined) => iso ? `${new Date(iso).toLocaleString()} (${ago(iso)})` : "—";
</script>

<PageHeader title="Connections" subtitle={loaded ? `${plural(items.length, "linked connection")}${fetched ? " · Plaid status as of " + new Date(fetched).toLocaleTimeString() : ""}` : "Loading…"}>
  {#snippet actions()}
    <button class="ghost" onclick={refresh} disabled={refreshing} title="Ask Plaid for fresh connection status"><RefreshCw size={15} class={refreshing ? "spin" : ""} aria-hidden="true" />Refresh from Plaid</button>
  {/snippet}
</PageHeader>

{#if error}<p class="err">{error}</p>{/if}

{#if dups}
  <section class="card card-pad dups">
    <div class="head"><Copy size={16} aria-hidden="true" /><h2>Duplicate accounts</h2><Pill tone={dupCount ? "warn" : "ok"} label={dupCount ? dupCount + " found" : "None found"} /></div>
    <p class="muted small">{dupCount ? `The same real account is reachable through more than one linked connection, for example when two people each link the same joint account. Balances and transactions for these are counted more than once in owner totals and owner transaction lists.`
      : "No account appears through more than one connection."}</p>
    {#each dups.connections as c (c.item_ids.join())}
      <p class="warnline">{c.institution}: {c.item_ids.length} connections ({c.item_ids.map(short).join(", ")}) cover the same accounts. Each one is a separate Plaid Item, so you're likely paying for both.</p>
    {/each}
    {#if dups.accounts.length}
      <div class="scroll-x"><table class="data">
        <thead><tr><th>Account</th><th>Seen under</th><th class="num">Balance</th><th>Match</th></tr></thead>
        <tbody>
          {#each [...dups.accounts].sort((x, y) => cmp(x.institution, y.institution) || cmp(x.mask, y.mask)) as g (g.institution + g.mask + g.type)}
            <tr>
              <td>{g.institution}<small>{g.subtype || g.type} ··{g.mask}</small></td>
              <td>{#each [...g.members].sort((x, y) => cmp(x.owner, y.owner)) as m (m.item_id + m.name)}<div>{m.owner} <span class="muted">· {m.name} · connection {short(m.item_id)}</span></div>{/each}</td>
              <td class="num">{#each g.members as m (m.item_id + m.name)}<div>{usd(m.balance)}</div>{/each}</td>
              <td><Pill tone={g.confidence === "high" ? "bad" : "warn"} label={g.confidence === "high" ? "Same balance" : "Balances differ"} /></td>
            </tr>
          {/each}
        </tbody>
      </table></div>
    {/if}
  </section>
{/if}

{#if loaded && !items.length && !error}
  <Empty icon={Plug} title="No banks linked yet">Connect a bank to start syncing balances and transactions. <p><button onclick={() => startLink()}>Connect bank</button></p></Empty>
{/if}

{#each institutions as inst (inst.name)}
  {@const [tone, label] = worst(inst.list)}
  <section class="inst">
    <div class="ihead">
      <Avatar name={inst.name} size={36} square />
      <div class="it"><h2>{inst.name}</h2><span class="muted small">{plural(inst.list.length, "connection")} · {plural(inst.list.reduce((n, i) => n + i.accounts.length, 0), "account")}</span></div>
      <Pill {tone} {label} />
    </div>
    {#each inst.list as i (i.item_id)}
      {@const [t, l] = health(i)}
      <article class="card conn">
        <div class="chead">
          <h3>{i.label}</h3>
          <Pill tone={t} label={l} />
          <span class="spacer"></span>
          {#if i.identity_status === "needs_consent"}<button class="sm" onclick={() => startLink(i.item_id)}>Grant permission</button>{/if}
          <button class="quiet sm" onclick={() => { renaming = i; nickname = i.nickname ?? ""; renameOpen = true; }}><Pencil size={14} aria-hidden="true" />Rename</button>
          <button class="quiet danger sm" onclick={() => { unlinking = i; unlinkErr = ""; unlinkOpen = true; }}><Unlink size={14} aria-hidden="true" />Unlink</button>
        </div>
        <dl>
          <dt>Connection</dt><dd>{i.suffix ? "…" + i.suffix : ""}{i.owners.length ? ` · ${[...i.owners].sort(cmp).join(", ")}` : ""}{i.created_at ? ` · linked ${new Date(i.created_at).toLocaleDateString()}` : ""}</dd>
          <dt>Last sync (this app)</dt><dd>{when(i.last_synced)}</dd>
          {#if i.plaid}<dt>Transactions updated (Plaid)</dt><dd>{when(i.plaid.transactions_last_success)}</dd>{/if}
          {#if i.plaid?.investments_last_success}<dt>Investments updated (Plaid)</dt><dd>{when(i.plaid.investments_last_success)}</dd>{/if}
          {#if i.plaid?.consent_expiration_time}<dt>Consent expires</dt><dd>{when(i.plaid.consent_expiration_time)}</dd>{/if}
          {#if i.plaid}<dt>Products</dt><dd>{(i.plaid.consented_products || []).join(", ") || "—"}</dd>{/if}
          <dt>Owner detection</dt><dd>{i.identity_status ?? "not tried yet"}</dd>
        </dl>
        {#if i.last_error}<p class="err">Sync error: {i.last_error}</p>{/if}
        {#if i.plaid?.error}<p class="err">Plaid item error: {i.plaid.error}</p>{/if}
        {#if failedAfterSuccess(i)}<p class="err">Last transactions update failed {when(i.plaid?.transactions_last_failure)}</p>{/if}
        {#if i.plaid_error}<p class="err">Could not reach Plaid for this item: {i.plaid_error}</p>{/if}
        <div class="scroll-x"><table class="data">
          <thead><tr><th>Show</th><th>Account</th><th>Owner</th><th>Type</th><th class="num">Balance</th><th>Balance as of</th></tr></thead>
          <tbody>
            {#each [...i.accounts].sort(byName) as a (a.account_id)}
              <tr class:off={a.hidden}>
                <td><Switch checked={!a.hidden} label={`Show ${a.name}`} onchange={(v) => setShown(a, v)} /></td>
                <td class="dim">{a.name}{a.mask ? " ··" + a.mask : ""}{#if a.hidden}<small>Hidden</small>{/if}</td>
                <td>
                  <select class="ownersel" aria-label={`Owner of ${a.name}`} value={a.owner_override ?? ""} onchange={(e) => pickOwner(a, e.currentTarget)}>
                    <option value="">Detected: {a.owner_detected ?? "none"}</option>
                    {#each ownerOptions(a) as o (o)}<option value={o}>{o}</option>{/each}
                    <option value="__new__">New owner…</option>
                  </select>
                </td>
                <td class="dim">{a.group}</td>
                <td class="num dim">{usd(a.balance, a.currency)}</td>
                <td class="dim muted">{when(a.updated_at)}</td>
              </tr>
            {/each}
          </tbody>
        </table></div>
      </article>
    {/each}
  </section>
{/each}

<Dialog bind:open={renameOpen} title={renaming?.institution ?? "Rename connection"} onsubmit={rename}>
  <label class="field">Nickname<input bind:value={nickname} maxlength="60" autocomplete="off" placeholder={renaming?.owners.length ? renaming.owners.join(", ") : "e.g. Alex's Schwab"}></label>
  {#snippet actions()}<button type="submit">Save</button>{/snippet}
</Dialog>

<Dialog bind:open={newOwnerOpen} title="New owner" onsubmit={() => { const n = newOwner.trim(); if (!n) return; newOwnerOpen = false; update(newOwnerFor!.account_id, { owner: n }); }}>
  <label class="field">Owner name<input bind:value={newOwner} maxlength="80" autocomplete="off" placeholder="e.g. Sam Smith"></label>
  {#snippet actions()}<button type="submit">Save</button>{/snippet}
</Dialog>

<Dialog bind:open={unlinkOpen} title={unlinking ? `Unlink ${unlinking.institution} · ${unlinking.label}?` : "Unlink connection"} onsubmit={unlink}>
  {#if unlinking}
    <p>This revokes the connection at Plaid, which ends access and billing for it, and permanently deletes its
      <b>{plural(unlinking.accounts.length, "account")}</b> and <b>{plural(unlinking.transaction_count, "stored transaction")}</b> from this app.
      It can't be undone. To bring it back you'd link the bank again and log in at the bank.</p>
  {/if}
  {#if unlinkErr}<p class="err">{unlinkErr}</p>{/if}
  {#snippet actions()}<button type="submit" class="danger" disabled={unlinkBusy}>{unlinkBusy ? "Unlinking…" : "Unlink"}</button>{/snippet}
</Dialog>

<style>
  .dups { margin-bottom:28px } .head { display:flex; align-items:center; gap:8px; color:var(--muted) } .head h2 { font-size:15px; color:var(--fg); flex:1 }
  .dups > p { margin:8px 0 0 } .dups table { margin-top:12px } .warnline { color:var(--warn); font-size:13px }
  .inst { margin-bottom:30px }
  .ihead { display:flex; align-items:center; gap:12px; margin-bottom:12px } .it { flex:1; display:flex; flex-direction:column } .it h2 { font-size:17px }
  .conn { padding:16px 18px 6px; margin-bottom:12px }
  .chead { display:flex; align-items:center; gap:8px; flex-wrap:wrap } .chead h3 { font-size:15px } .spacer { flex:1 }
  dl { display:grid; grid-template-columns:max-content 1fr; gap:4px 18px; margin:12px 0 4px; font-size:13px } dt { color:var(--muted) } dd { margin:0; overflow-wrap:anywhere }
  .conn table { margin-top:10px } .conn .err { margin:6px 0 0 }
  tr.off .dim { opacity:.45 }
  .ownersel { font-size:13px; max-width:240px; min-width:170px; padding:5px 8px }
  @media (max-width:560px) { dl { grid-template-columns:1fr; gap:0 } dd { margin-bottom:6px } }
</style>
