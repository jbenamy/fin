<!-- An investment account's allocation bar and holdings table (from /api/holdings). -->
<script lang="ts">
  import { ChartPie, Layers, TriangleAlert } from "@lucide/svelte";
  import { api, message } from "../../lib/api";
  import { data } from "../../lib/data.svelte";
  import { day, pct, signed, usd } from "../../lib/format";
  import type { Holdings } from "../../lib/types";

  let { accountId }: { accountId: string } = $props();
  // Results are tagged with their account, so switching accounts shows "Loading" instead of the previous one's holdings,
  // while a refetch for the same account (after a sync) keeps the current table on screen.
  let loaded = $state<{ id: string; h: Holdings } | null>(null), error = $state("");
  // $derived passes on only a changed id (the prop is a getter on an account object that a reload replaces).
  const id = $derived(accountId);
  const h = $derived(loaded?.id === id ? loaded.h : null);
  let seq = 0;
  // Refetch when the account changes or after a sync / edit (data.version).
  $effect(() => {
    void data.version;
    const forId = id, mine = ++seq; error = "";
    api<Holdings>("/api/holdings?account=" + encodeURIComponent(forId))
      .then((d) => { if (mine === seq) loaded = { id: forId, h: d }; }).catch((e) => { if (mine === seq) error = message(e); });
  });

  const shown = $derived(h ? h.allocation.filter((c) => c.value > 0 && c.pct) : []);
  const hasCost = $derived(!!h?.holdings.some((x) => x.cost_basis != null));
  const hasVested = $derived(!!h?.holdings.some((x) => x.vested_value != null && x.vested_value !== x.value));
  const anyStale = $derived(!!h?.holdings.some((x) => x.stale));
  const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
</script>

{#if error}
  <p class="err">Couldn't load holdings: {error}</p>
{:else if !h}
  <p class="muted small">Loading holdings…</p>
{:else if !h.holdings.length}
  <p class="muted small">{h.synced ? "No holdings reported for this account." : "Holdings appear after the next sync."}</p>
{:else}
  <div class="grid">
    {#if shown.length}
      <section class="card card-pad">
        <h2 class="section-title"><ChartPie size={14} aria-hidden="true" />Allocation</h2>
        <!-- One bar split by asset class; the legend under it doubles as the value table. Colors are fixed per class (--c<slot>). -->
        <div class="alloc" role="img" aria-label={shown.map((c) => `${c.class} ${pct(c.pct)}`).join(", ")}>
          {#each shown as c (c.class)}<span class="seg" style="flex-grow:{c.pct}; background:var(--c{c.slot})" title="{c.class}: {usd(c.value)} ({pct(c.pct)})"></span>{/each}
        </div>
        <ul class="legend">
          {#each h.allocation as c (c.class)}
            <li><span class="sw" style="background:var(--c{c.slot})"></span><span>{c.class}</span><span class="num">{usd(c.value)}</span><span class="num muted">{pct(c.pct)}</span></li>
          {/each}
        </ul>
      </section>
    {/if}
    <section class="card holdings">
      <h2 class="section-title pad"><Layers size={14} aria-hidden="true" />Holdings</h2>
      <div class="scroll-x">
        <table class="data">
          <thead><tr><th>Security</th><th class="type">Type</th><th class="num">Quantity</th><th class="num">Price</th><th class="num">Value</th><th class="num">Share</th>
            {#if hasCost}<th class="num">Cost basis</th><th class="num">Gain / loss</th>{/if}{#if hasVested}<th class="num">Vested</th>{/if}</tr></thead>
          <tbody>
            {#each h.holdings as x, i (i)}
              <tr>
                <td><span class="tick">{x.ticker || x.name || "Unknown"}</span>{#if x.ticker && x.name}<small>{x.name}</small>{/if}</td>
                <td class="muted type">{x.class}</td>
                <td class="num">{qty(x.quantity)}</td>
                <td class="num">{x.price == null ? "—" : usd(x.price, x.currency)}{#if x.price_as_of}<small class:stale={x.stale}>{#if x.stale}<TriangleAlert size={11} aria-label="Stale price" /> {/if}{day(x.price_as_of)}</small>{/if}</td>
                <td class="num strong">{usd(x.value, x.currency)}</td>
                <td class="num muted">{pct(x.pct)}</td>
                {#if hasCost}
                  <td class="num">{usd(x.cost_basis, x.currency)}</td>
                  <td class="num" class:neg={(x.gain ?? 0) < 0} class:pos={(x.gain ?? 0) > 0}>{signed(x.gain, (n) => usd(n, x.currency))}{#if x.gain_pct != null}<small>{signed(x.gain_pct, pct)}</small>{/if}</td>
                {/if}
                {#if hasVested}<td class="num">{usd(x.vested_value, x.currency)}</td>{/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if anyStale}<p class="muted small note"><TriangleAlert size={12} color="var(--warn)" aria-hidden="true" /> Price is more than a few days old.</p>{/if}
    </section>
  </div>
{/if}

<style>
  /* Allocation colors: one fixed hue per asset class, validated as a set on the dark surface. */
  .grid { --c0:#3987e5; --c1:#d95926; --c2:#199e70; --c3:#c98500; --c4:#d55181; --c5:#008300; --c6:#9085e9; --c7:#e66767; display:grid; grid-template-columns:minmax(0, 1fr); gap:16px }
  .pad { padding:16px 18px 0 }
  .alloc { display:flex; gap:2px; height:14px } .seg { min-width:2px }
  .seg:first-child { border-radius:4px 0 0 4px } .seg:last-child { border-radius:0 4px 4px 0 } .seg:only-child { border-radius:4px } .seg:hover { filter:brightness(1.25) }
  .legend { list-style:none; padding:0; margin:14px 0 0; display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:4px 28px; font-size:13px }
  .legend li { display:grid; grid-template-columns:12px 1fr auto 52px; gap:8px; align-items:center; padding:3px 0 }
  .legend .num { text-align:right } .sw { width:10px; height:10px; border-radius:3px }
  .tick { font-weight:600 } .strong { font-weight:600 }
  .stale { color:var(--warn) !important } .note { padding:0 18px 14px; margin:8px 0 0 }
  .holdings table { margin-top:8px }
  /* A narrow card (e.g. a laptop with the account list beside it) drops the type column; the allocation above shows types. */
  .holdings { container-type:inline-size }
  @container (max-width: 860px) { .type { display:none } }
</style>
