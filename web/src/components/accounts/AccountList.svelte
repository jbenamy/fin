<!-- The account list: owners -> account groups -> accounts, with collapse state that survives reloads. -->
<script lang="ts">
  import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "@lucide/svelte";
  import Avatar from "../Avatar.svelte";
  import { balanceOnly, byGroup, ownerList, plural, sum, usd, where } from "../../lib/format";
  import { groupIcon } from "../../lib/icons";
  import { store } from "../../lib/store";
  import type { Account } from "../../lib/types";

  let { accounts, selected, onselect }: { accounts: Account[]; selected: string | null; onselect: (id: string) => void } = $props();

  let collapsed = $state(new Set<string>());
  try { collapsed = new Set(JSON.parse(store.get("collapsed", "[]")!)); } catch {}
  const save = () => store.set("collapsed", JSON.stringify([...collapsed]));
  function toggle(key: string) { const next = new Set(collapsed); if (!next.delete(key)) next.add(key); collapsed = next; save(); }
  function setAll(collapse: boolean) { collapsed = new Set(collapse ? accounts.map((a) => "o:" + a.owner) : []); save(); }

  const owners = $derived(ownerList(accounts).map((o) => ({ o, mine: accounts.filter((a) => a.owner === o) })));
  const tip = (a: Account) => [a.name, where(a), `${a.group} · ${a.owner}`,
    usd(a.balance) + (a.kind === "cash" && a.available != null && a.available !== a.balance ? ` (${usd(a.available)} available)` : "")].join("\n");
</script>

<div class="list card">
  <div class="tools">
    <span class="section-title">Accounts</span>
    <button class="quiet icon sm" title="Expand all" aria-label="Expand all" onclick={() => setAll(false)}><ChevronsUpDown size={15} /></button>
    <button class="quiet icon sm" title="Collapse all" aria-label="Collapse all" onclick={() => setAll(true)}><ChevronsDownUp size={15} /></button>
  </div>
  <div class="scroll">
    {#each owners as { o, mine } (o)}
      {@const key = "o:" + o}
      {@const open = !collapsed.has(key)}
      <div class="owner" class:sel={selected === key}>
        <button class="quiet icon tog" aria-label="{open ? 'Collapse' : 'Expand'} {o}" aria-expanded={open} onclick={() => toggle(key)}>
          {#if open}<ChevronDown size={15} />{:else}<ChevronRight size={15} />{/if}
        </button>
        <button class="orow" title="{o}&#10;{plural(mine.length, 'account')} · {usd(sum(mine))}&#10;Show all their transactions" onclick={() => onselect(key)}>
          <Avatar name={o} size={24} /><span class="oname">{o}</span><span class="num" class:neg={sum(mine) < 0}>{usd(sum(mine))}</span>
        </button>
      </div>
      {#if open}
        {#each byGroup(mine) as [group, list] (group)}
          {@const gk = `g:${o}|${group}`}
          {@const gopen = !collapsed.has(gk)}
          {@const Icon = groupIcon(group)}
          <button class="grp" aria-expanded={gopen} onclick={() => toggle(gk)} title="{group}{balanceOnly(list) ? ' (balance only)' : ''}&#10;{plural(list.length, 'account')} · {usd(sum(list))}">
            {#if gopen}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}<Icon size={13} aria-hidden="true" />
            <span class="gname">{group}{gopen ? "" : ` (${list.length})`}</span><span class="num">{usd(sum(list))}</span>
          </button>
          {#if gopen}
            {#each list as a (a.account_id)}
              <button class="acct" class:sel={selected === a.account_id} title={tip(a)} onclick={() => onselect(a.account_id)}>
                <span class="an">{a.name}<small>{where(a)}</small></span><span class="num" class:neg={(a.balance ?? 0) < 0}>{usd(a.balance)}</span>
              </button>
            {/each}
          {/if}
        {/each}
      {/if}
    {/each}
  </div>
</div>

<style>
  .list { position:sticky; top:24px; display:flex; flex-direction:column; max-height:calc(100vh - 48px); padding:12px 8px 8px }
  .tools { display:flex; align-items:center; gap:2px; padding:0 6px 8px; border-bottom:1px solid var(--line); margin-bottom:6px }
  .tools .section-title { flex:1; margin:0 }
  .scroll { overflow-y:auto; min-height:0; padding:0 2px }
  .scroll button { font-weight:400; color:var(--fg); background:none; border:0; text-align:left; width:100%; white-space:normal }
  .scroll button:hover { background:var(--hover); color:var(--fg) }
  .owner { display:flex; align-items:center; gap:2px; margin-top:8px; border-radius:var(--radius-sm) }
  .owner.sel .orow { background:var(--accent-soft) }
  .scroll .tog { width:auto; padding:4px; color:var(--muted) }
  .orow { display:flex; align-items:center; gap:8px; padding:6px 8px; font-weight:600; border-radius:var(--radius-sm); justify-content:flex-start }
  .oname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis }
  .grp { display:flex; align-items:center; gap:6px; justify-content:flex-start; padding:5px 8px 5px 14px; margin-top:4px; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); border-radius:6px }
  .grp .gname { flex:1; min-width:0 } .grp .num { font-size:11px }
  .acct { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; padding:7px 8px 7px 34px; border-radius:var(--radius-sm); white-space:normal }
  .acct.sel { background:var(--accent-soft) } .acct.sel .an { color:var(--accent-strong) }
  .an { min-width:0; overflow-wrap:anywhere } .an small { display:block; color:var(--muted); font-size:11.5px }
  @media (max-width:980px) { .list { position:static; max-height:50vh } }
</style>
