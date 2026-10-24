<!-- /accounts: the account list + the selected account's (or owner's) balance, holdings and transactions. -->
<script lang="ts">
  import { Pencil, Wallet } from "@lucide/svelte";
  import AccountList from "../components/accounts/AccountList.svelte";
  import Holdings from "../components/accounts/Holdings.svelte";
  import Register from "../components/accounts/Register.svelte";
  import Avatar from "../components/Avatar.svelte";
  import Dialog from "../components/Dialog.svelte";
  import Empty from "../components/Empty.svelte";
  import IconChip from "../components/IconChip.svelte";
  import { api, message } from "../lib/api";
  import { data, lastSynced, updateAccount } from "../lib/data.svelte";
  import { dateTime, ownerList, plural, sum, usd, where } from "../lib/format";
  import { groupIcon, KIND_TONE } from "../lib/icons";
  import { startLink } from "../lib/link.svelte";
  import { navigate, route } from "../lib/router.svelte";
  import type { Account } from "../lib/types";

  // The selection lives in the address (#<account id> or #o:<owner>), so reloads and dashboard links land on it.
  const requested = $derived(route.hash.length > 1 ? decodeURIComponent(route.hash.slice(1)) : null);
  const exists = (id: string | null) => !!id && data.accounts.some((a) => (id.startsWith("o:") ? "o:" + a.owner : a.account_id) === id);
  const firstOwner = $derived(ownerList(data.accounts)[0]);
  const selected = $derived(exists(requested) ? requested : firstOwner ? "o:" + firstOwner : null);
  const owner = $derived(selected?.startsWith("o:") ? selected.slice(2) : null);
  const acct = $derived(owner === null ? data.accounts.find((a) => a.account_id === selected) : undefined);
  const select = (id: string) => navigate("/accounts" + location.search + "#" + encodeURIComponent(id), true);

  const names = $derived(Object.fromEntries(data.accounts.map((a) => [a.account_id, a.name])));
  const errors = $derived([...new Set(data.accounts.filter((a) => a.last_error).map((a) => a.institution + ": " + a.last_error))]);
  const mine = $derived(owner ? data.accounts.filter((a) => a.owner === owner) : []);
  const synced = $derived(lastSynced());

  // Edit dialog: a blank owner / "Automatic" group or register clears the manual override.
  // Only investment accounts offer the register choice; every other account always has one.
  let groups = $state<string[]>([]);
  let editOpen = $state(false), edOwner = $state(""), edGroup = $state(""), edReg = $state(""), edErr = $state(""), saving = $state(false);
  async function edit(a: Account) {
    if (!groups.length) try { groups = await api<string[]>("/api/groups"); } catch {}
    edOwner = a.owner_override ?? ""; edGroup = a.group_override ?? ""; edReg = String(a.register_override ?? ""); edErr = "";
    editOpen = true;
  }
  async function save() {
    const a = acct!; saving = true;
    try {
      await updateAccount(a.account_id, {
        owner: edOwner, group: edGroup, ...(a.kind === "investment" ? { register: edReg === "" ? null : edReg === "true" } : {}),
      });
      editOpen = false;
    } catch (e) { edErr = message(e); }
    saving = false;
  }
</script>

{#if data.error}
  <p class="err">Couldn't load accounts: {data.error}</p>
{:else if data.loaded && !data.accounts.length}
  <Empty icon={Wallet} title="No accounts yet">Connect a bank to get started. <p><button onclick={() => startLink()}>Connect bank</button></p></Empty>
{:else if data.loaded}
  <div class="layout">
    <aside><AccountList accounts={data.accounts} {selected} onselect={select} /></aside>
    <section class="detail">
      {#if acct}
        {@const Icon = groupIcon(acct.group)}
        <header class="dhead">
          <IconChip icon={Icon} tone={KIND_TONE[acct.kind]} size={44} />
          <div class="dt">
            <h1>{acct.name}</h1>
            <p class="muted">{where(acct)} · {acct.owner} · {acct.group}</p>
          </div>
          <button class="ghost sm" onclick={() => edit(acct)}><Pencil size={14} aria-hidden="true" />Edit</button>
        </header>
        <div class="balance card">
          <div>
            <div class="bl">{acct.kind === "investment" ? "Market value" : acct.kind === "debt" ? "Owed" : "Balance"}</div>
            <div class="bv num" class:neg={(acct.balance ?? 0) < 0}>{usd(acct.balance)}</div>
          </div>
          {#if acct.kind === "cash" && acct.available != null && acct.available !== acct.balance}
            <div><div class="bl">Available</div><div class="bv2 num">{usd(acct.available)}</div></div>
          {/if}
          <div class="asof muted small">As of {dateTime(acct.updated_at)}</div>
        </div>
      {:else if owner}
        <header class="dhead">
          <Avatar name={owner} size={44} />
          <div class="dt"><h1>{owner}</h1><p class="muted">{plural(mine.length, "account")} · {usd(sum(mine))}</p></div>
        </header>
      {/if}

      {#each errors as e (e)}<p class="err">{e}</p>{/each}

      {#if acct?.kind === "investment"}
        <Holdings accountId={acct.account_id} />
      {/if}

      {#if acct && !acct.register}
        <p class="muted small">Transactions aren't shown for brokerage accounts; turn them on under Edit for a cash management account.</p>
      {:else if selected}
        <div class="regh"><h2 class="section-title">Transactions</h2><span class="muted small">{synced ? "Last synced " + dateTime(synced) : "Not synced yet"}</span></div>
        <Register scope={selected} names={acct ? null : names} />
      {/if}
    </section>
  </div>
{/if}

{#if acct}
  <Dialog bind:open={editOpen} title={acct.name} onsubmit={save}>
    <label class="field">Owner<input bind:value={edOwner} list="owners" autocomplete="off" placeholder={acct.owner_detected ? `Detected: ${acct.owner_detected}` : "No owner detected"}></label>
    <datalist id="owners">{#each ownerList(data.accounts).filter((o) => o !== "Unassigned") as o (o)}<option value={o}></option>{/each}</datalist>
    <p class="hint">Leave blank to use the detected owner.</p>
    <label class="field">Group<select bind:value={edGroup}><option value="">Automatic</option>{#each groups as g (g)}<option value={g}>{g}</option>{/each}</select></label>
    {#if acct.kind === "investment"}
      <label class="field">Transactions<select bind:value={edReg}>
        <option value="">Automatic ({acct.register_auto ? "shown" : "balance only"})</option><option value="true">Show (cash management)</option><option value="false">Balance only</option>
      </select></label>
      <p class="hint">Transactions appear after the next sync.</p>
    {/if}
    {#if edErr}<p class="err">{edErr}</p>{/if}
    {#snippet actions()}<button type="submit" disabled={saving}>Save</button>{/snippet}
  </Dialog>
{/if}

<style>
  .layout { display:grid; grid-template-columns:300px minmax(0, 1fr); gap:24px; align-items:start }
  .detail { display:flex; flex-direction:column; gap:16px; min-width:0 } .detail > p { margin:0 } /* the column gap spaces them */
  .dhead { display:flex; align-items:center; gap:14px } .dt { flex:1; min-width:0 }
  .dt h1 { font-size:22px; overflow-wrap:anywhere } .dt p { margin:3px 0 0; font-size:13.5px }
  .balance { display:flex; align-items:flex-end; gap:12px 40px; flex-wrap:wrap; padding:18px 20px }
  .bl { color:var(--muted); font-size:12.5px } .bv { font-size:34px; font-weight:650; letter-spacing:-.02em; line-height:1.15 }
  .bv2 { font-size:20px; font-weight:600 } .asof { margin-left:auto }
  .regh { display:flex; align-items:baseline; gap:12px; margin-top:6px } .regh .section-title { margin:0; flex:1 }
  @media (max-width:980px) { .layout { grid-template-columns:1fr } }
</style>
