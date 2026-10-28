<!-- "/": net worth, cash / investments / owed, and a card for every account (owner -> account type). -->
<script lang="ts">
  import { CreditCard, Landmark, TrendingUp, Wallet } from "@lucide/svelte";
  import Avatar from "../components/Avatar.svelte";
  import Empty from "../components/Empty.svelte";
  import IconChip from "../components/IconChip.svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import Switch from "../components/Switch.svelte";
  import { data } from "../lib/data.svelte";
  import { byGroup, dateTime, ownerList, plural, sum, usd, usd0, where } from "../lib/format";
  import { groupIcon, KIND_TONE } from "../lib/icons";
  import { startLink } from "../lib/link.svelte";
  import { store } from "../lib/store";
  import type { Account, Kind } from "../lib/types";

  let owner = $state<string | null>(null); // null = everyone
  // Zero-balance accounts are hidden by default; the choice is remembered.
  let hideZero = $state(store.get("hideZero") !== "0");

  const owners = $derived(ownerList(data.accounts));
  const everything = $derived(owner ? data.accounts.filter((a) => a.owner === owner) : data.accounts);
  const zeros = $derived(everything.filter((a) => a.balance === 0).length);
  const shown = $derived(hideZero ? everything.filter((a) => a.balance !== 0) : everything); // net worth is unaffected: zeros add nothing
  const ofKind = (kind: Kind) => shown.filter((a) => a.kind === kind);
  const updated = $derived(data.accounts.map((a) => a.updated_at).filter(Boolean).sort().pop());
  const sections = $derived((owner ? [owner] : owners).map((o) => ({ o, mine: shown.filter((a) => a.owner === o) })).filter(({ mine }) => mine.length));

  const tiles = $derived([
    { label: "Cash", icon: Wallet, tone: KIND_TONE.cash, list: ofKind("cash") },
    { label: "Investments", icon: TrendingUp, tone: KIND_TONE.investment, list: ofKind("investment") },
    { label: "Owed", icon: CreditCard, tone: KIND_TONE.debt, list: ofKind("debt") },
  ]);
  // The bar under net worth splits assets into cash and investments; it's left out when there are no assets.
  const assets = $derived(sum(shown.filter((a) => a.kind !== "debt")));

  const note = (a: Account) => !a.register ? "Balance only" : a.kind === "debt" ? "Owed" : a.available != null && a.available !== a.balance ? `${usd(a.available)} available` : "";
  const setHideZero = (v: boolean) => store.set("hideZero", v ? "1" : "0");
</script>

<PageHeader title="Overview" subtitle={updated ? `Balances as of ${dateTime(updated)}` : ""} />

{#if data.error}
  <p class="err">Couldn't load accounts: {data.error}</p>
{:else if data.loaded && !data.accounts.length}
  <Empty icon={Landmark} title="No accounts yet">Connect a bank to see balances here. <p><button onclick={() => startLink()}>Connect bank</button></p></Empty>
{:else if data.loaded}
  <section class="hero card">
    <div>
      <div class="label">Net worth{owner ? ` · ${owner}` : ""}</div>
      <div class="value num">{usd(sum(shown))}</div>
    </div>
    {#if assets > 0}
      <div class="mix" aria-hidden="true">
        {#each tiles.slice(0, 2) as t (t.label)}<span class="seg {t.tone}" style="flex-grow:{Math.max(sum(t.list), 0)}"></span>{/each}
      </div>
    {/if}
    <div class="tiles">
      {#each tiles as t (t.label)}
        <div class="tile">
          <IconChip icon={t.icon} tone={t.tone} />
          <div><div class="tl"><span class="dot {t.tone}" aria-hidden="true"></span>{t.label}</div><div class="tv num">{usd0(sum(t.list))}</div><div class="ts">{plural(t.list.length, "account")}</div></div>
        </div>
      {/each}
    </div>
  </section>

  <div class="toolbar">
    {#if owners.length > 1}
      <div class="filters" role="group" aria-label="Filter by owner">
        {#each [null, ...owners] as o (o ?? "")}
          <button class="chip" aria-pressed={owner === o} onclick={() => (owner = o)}>{#if o}<Avatar name={o} size={20} />{/if}{o ?? "Everyone"}</button>
        {/each}
      </div>
    {/if}
    <label class="toggle"><span>Hide $0 accounts{hideZero && zeros ? ` (${zeros} hidden)` : ""}</span><Switch bind:checked={hideZero} label="Hide $0 accounts" onchange={setHideZero} /></label>
  </div>

  {#each sections as { o, mine } (o)}
    <section class="owner">
      <div class="ohead"><Avatar name={o} size={34} /><h2>{o}</h2><span class="muted small">{plural(mine.length, "account")}</span><span class="total num">{usd(sum(mine))}</span></div>
      <!-- Groups flow side by side, each a column of its accounts, so single-account groups don't leave empty rows.
           Cards are all one height (the name is one line, the institution always takes two), so side-by-side cards line up. -->
      <div class="groups">
        {#each byGroup(mine) as [group, list] (group)}
          {@const Icon = groupIcon(group)}
          <div>
            <div class="grp" title={group}><Icon size={14} aria-hidden="true" /><span>{group}</span><span class="num">{usd(sum(list))}</span></div>
            <div class="cards">
              {#each list as a (a.account_id)}
                <a class="acard card" href={"/accounts#" + encodeURIComponent(a.account_id)} aria-label="{a.name}, {usd(a.balance)}">
                  <div class="atop"><IconChip icon={Icon} tone={KIND_TONE[a.kind]} size={30} />
                    <div class="aname"><div class="n" title={a.name}>{a.name}</div><div class="w" title={where(a)}>{where(a)}</div></div></div>
                  <div class="aval num" class:neg={(a.balance ?? 0) < 0}>{usd(a.balance)}</div>
                  <div class="afoot">{note(a)}</div>
                </a>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {:else}
    <p class="muted">Every account here has a $0 balance. Turn off “Hide $0 accounts” to see them.</p>
  {/each}
{/if}

<style>
  .hero { padding:22px 24px; margin-bottom:22px; background:linear-gradient(135deg, rgba(139,143,255,.10), transparent 55%), var(--surface) }
  .label { color:var(--muted); font-size:13.5px } .value { font-size:44px; font-weight:650; letter-spacing:-.025em; line-height:1.15; margin-top:2px }
  .mix { display:flex; gap:2px; height:8px; margin:18px 0 4px; max-width:520px } .seg { border-radius:2px; min-width:3px } .seg:first-child { border-radius:4px 2px 2px 4px } .seg:last-child { border-radius:2px 4px 4px 2px }
  .seg.ok { background:var(--ok) } .seg.accent { background:var(--accent) }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:12px; margin-top:18px }
  .tile { display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:10px; background:var(--surface-2); border:1px solid var(--line) }
  .tl { color:var(--muted); font-size:12.5px }
  .dot { display:none; width:8px; height:8px; border-radius:2px; margin-right:6px; vertical-align:1px }
  .dot.ok { background:var(--ok) } .dot.accent { background:var(--accent) } .dot.bad { background:var(--bad) } .tv { font-size:20px; font-weight:600 } .ts { color:var(--faint); font-size:12px }

  .toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px 20px; flex-wrap:wrap; margin:0 0 8px }
  .filters { display:flex; gap:6px; flex-wrap:wrap }
  .chip { gap:7px; background:var(--surface); color:var(--fg); border-color:var(--line); border-radius:99px; padding:5px 13px }
  .chip:has(:global(.av)) { padding-left:5px } .chip:hover { background:var(--hover) }
  .chip[aria-pressed="true"] { background:var(--accent-soft); border-color:var(--accent); color:var(--accent-strong) }
  .toggle { display:inline-flex; align-items:center; gap:10px; color:var(--muted); cursor:pointer; margin-left:auto; font-size:13.5px }

  .owner { margin-top:26px }
  .ohead { display:flex; align-items:center; gap:12px; padding-bottom:10px; border-bottom:1px solid var(--line) }
  .ohead h2 { font-size:17px } .ohead .muted { flex:1 } .total { font-size:17px; font-weight:600 }
  .grp { display:flex; align-items:center; gap:7px; margin:18px 0 10px; font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted) }
  .grp span:first-of-type { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  .groups { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:4px 14px }
  .groups > div { min-width:0 } .cards { display:grid; grid-template-columns:minmax(0, 1fr); gap:12px }
  .acard { display:flex; flex-direction:column; padding:14px 16px; color:inherit; text-decoration:none; transition:border-color .12s, transform .12s }
  .acard:hover { border-color:var(--accent); color:inherit; transform:translateY(-1px) }
  .atop { display:flex; gap:10px; align-items:flex-start } .aname { min-width:0 }
  /* Fixed line counts so every card is the same height; the full text is in the title tooltip. */
  .n { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  .w { color:var(--muted); font-size:12px; line-height:1.4; min-height:2.8em; overflow-wrap:anywhere; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; overflow:hidden }
  .aval { font-size:24px; font-weight:600; margin-top:auto; padding-top:14px; letter-spacing:-.01em }
  .afoot { color:var(--muted); font-size:12px; line-height:1.4; min-height:1.4em }
  @media (max-width:560px) {
    .hero { padding:18px } .value { font-size:34px } .toggle { margin-left:0 }
    /* Three compact tiles in a row instead of a tall stack; the bar above keeps the colors. */
    .tiles { grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; margin-top:14px }
    .tile { padding:10px; gap:0 } .tile :global(.chip) { display:none } .dot { display:inline-block } .tl { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis } /* the dot keys the bar now the icon is gone */ .tv { font-size:15px } .ts { display:none }
  }
</style>
