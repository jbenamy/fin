<!-- An investment account's gain / loss per period and its value against the money put in (from /api/performance). -->
<script lang="ts">
  import { TrendingUp } from "@lucide/svelte";
  import { day, pct, signed, usd } from "../../lib/format";
  import { perAccount } from "../../lib/perAccount.svelte";
  import { store } from "../../lib/store";
  import type { Performance } from "../../lib/types";

  let { accountId }: { accountId: string } = $props();
  const res = perAccount<Performance>(() => accountId, (id) => "/api/performance?account=" + encodeURIComponent(id));
  const perf = $derived(res.value);

  let want = $state(store.get("fin.perf.period", "all")!);
  const choose = (key: string) => { want = key; store.set("fin.perf.period", key); };
  // A remembered period this account can't cover yet falls back to the longest one it has ("all").
  const period = $derived(perf?.periods.find((p) => p.key === want) ?? perf?.periods.at(-1) ?? null);
  const points = $derived(perf && period ? perf.series.filter((s) => s.date >= period.start) : (perf?.series ?? []));

  // Chart geometry: time on x (missed sync days stay gaps), one shared $ axis on y.
  let width = $state(600);
  const H = 220, M = { top: 12, right: 14, bottom: 26, left: 58 };
  const usdShort = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
  const t = (d: string) => Date.parse(d + "T00:00:00Z");
  const scale = $derived.by(() => {
    if (points.length < 2) return null;
    const vals = points.flatMap((p) => [p.value, p.invested]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi === lo) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    const t0 = t(points[0]!.date), t1 = t(points.at(-1)!.date), w = Math.max(width, 280);
    const x = (d: string) => M.left + ((t(d) - t0) / (t1 - t0)) * (w - M.left - M.right);
    const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * (H - M.top - M.bottom);
    return { x, y, ticks, w };
  });
  const path = (key: "value" | "invested") => scale ? points.map((p, i) => `${i ? "L" : "M"}${scale.x(p.date).toFixed(1)},${scale.y(p[key]).toFixed(1)}`).join("") : "";

  // Hover: the crosshair snaps to the nearest snapshot day.
  let hover = $state<number | null>(null);
  function move(e: PointerEvent) {
    if (!scale) return;
    const box = (e.currentTarget as SVGElement).getBoundingClientRect(), px = e.clientX - box.left;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(scale.x(p.date) - px) < Math.abs(scale.x(points[best]!.date) - px)) best = i; });
    hover = best;
  }
  const hp = $derived(hover != null ? points[hover] : null);
  const gainClass = (n: number) => (n < 0 ? "neg" : n > 0 ? "pos" : "");
</script>

{#if res.error}
  <p class="err">Couldn't load performance: {res.error}</p>
{:else if perf}
  <section class="card card-pad perf">
    <div class="head">
      <h2 class="section-title"><TrendingUp size={14} aria-hidden="true" />Performance</h2>
      {#if perf.periods.length > 1}
        <div class="periods" role="group" aria-label="Period">
          {#each perf.periods as p (p.key)}<button class="chip sm" aria-pressed={period?.key === p.key} onclick={() => choose(p.key)}>{p.label}</button>{/each}
        </div>
      {/if}
    </div>

    {#if !perf.activity_synced}
      <p class="muted small">Gains appear after the next sync reads this account's activity (deposits and withdrawals aren't gains).</p>
    {:else if !period}
      <p class="muted small">Gains appear after a second day of syncs. Plaid has no past values, so Fin records one each day from {perf.series[0] ? day(perf.series[0].date) : "the next sync"}.</p>
    {:else}
      <div class="stats">
        <div><div class="sl">Gain / loss</div><div class="sv num {gainClass(period.gain)}">{signed(period.gain, usd)}</div>
          <div class="ss num">{period.return == null ? "" : signed(period.return, pct)}</div></div>
        <div><div class="sl">Net contributions</div><div class="sv2 num">{signed(period.net_contributions, usd)}</div>
          <div class="ss muted">added minus withdrawn</div></div>
        <div><div class="sl">Dividends &amp; interest</div><div class="sv2 num">{usd(period.income)}</div>
          <div class="ss muted">{period.fees ? `fees ${usd(period.fees)}` : "included in gain"}</div></div>
        <div><div class="sl">Value</div><div class="sv2 num">{usd(period.end_value)}</div>
          <div class="ss muted">from {usd(period.start_value)} on {day(period.start)}</div></div>
      </div>
    {/if}

    {#if scale}
      <ul class="legend" aria-hidden="true">
        <li><span class="key value"></span>Market value</li>
        <li><span class="key invested"></span>Net invested</li>
      </ul>
      <div class="chart" bind:clientWidth={width}>
        <svg width={scale.w} height={H} role="img" onpointermove={move} onpointerleave={() => (hover = null)}
          aria-label="Market value from {usd(points[0]!.value)} to {usd(points.at(-1)!.value)}, net invested from {usd(points[0]!.invested)} to {usd(points.at(-1)!.invested)}, {day(points[0]!.date)} to {day(points.at(-1)!.date)}">
          {#each scale.ticks as v (v)}
            <line class="grid" x1={M.left} x2={scale.w - M.right} y1={scale.y(v)} y2={scale.y(v)} />
            <text class="tick" x={M.left - 8} y={scale.y(v)} text-anchor="end" dominant-baseline="middle">{usdShort(v)}</text>
          {/each}
          <text class="tick" x={M.left} y={H - 6}>{day(points[0]!.date)}</text>
          <text class="tick" x={scale.w - M.right} y={H - 6} text-anchor="end">{day(points.at(-1)!.date)}</text>
          <path class="line invested" d={path("invested")} />
          <path class="line value" d={path("value")} />
          {#if hp}
            <line class="cross" x1={scale.x(hp.date)} x2={scale.x(hp.date)} y1={M.top} y2={H - M.bottom} />
            <circle class="dot invested" cx={scale.x(hp.date)} cy={scale.y(hp.invested)} r="4" />
            <circle class="dot value" cx={scale.x(hp.date)} cy={scale.y(hp.value)} r="4" />
          {/if}
        </svg>
        {#if hp}
          {@const x = scale.x(hp.date)}
          <div class="tip" style="left:{Math.min(Math.max(x, 90), scale.w - 90)}px">
            <div class="td">{day(hp.date)}</div>
            <div><span class="key value"></span><b class="num">{usd(hp.value)}</b> <span class="muted">value</span></div>
            <div><span class="key invested"></span><b class="num">{usd(hp.invested)}</b> <span class="muted">invested</span></div>
            <div class="num {gainClass(hp.value - hp.invested)}">{signed(hp.value - hp.invested, usd)} <span class="muted">gain</span></div>
          </div>
        {/if}
      </div>
      <details>
        <summary class="muted small">Show as table</summary>
        <div class="scroll-x table">
          <table class="data">
            <thead><tr><th>Date</th><th class="num">Value</th><th class="num">Net invested</th><th class="num">Gain / loss</th></tr></thead>
            <tbody>
              {#each points.toReversed() as p (p.date)}
                <tr><td>{day(p.date)}</td><td class="num">{usd(p.value)}</td><td class="num">{usd(p.invested)}</td>
                  <td class="num {gainClass(p.value - p.invested)}">{signed(p.value - p.invested, usd)}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    {/if}
  </section>
{/if}

<style>
  /* Two series colors, validated as a pair on the dark surface (blue = value, amber = money put in). */
  .perf { --value:#3987e5; --invested:#c98500; display:flex; flex-direction:column; gap:14px }
  .head { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap }
  .head .section-title { margin:0 }
  .periods { display:flex; gap:4px; flex-wrap:wrap }
  .chip { background:var(--surface); color:var(--fg); border-color:var(--line); border-radius:99px; padding:4px 11px }
  .chip:hover { background:var(--hover) }
  .chip[aria-pressed="true"] { background:var(--accent-soft); border-color:var(--accent); color:var(--accent-strong) }
  /* Four figures in a row; two by two in a narrow card (phone, or a laptop with the account list beside it). */
  .perf { container-type:inline-size }
  .stats { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:14px 24px }
  @container (max-width: 640px) { .stats { grid-template-columns:repeat(2, minmax(0, 1fr)) } }
  .sl { font-size:12px; color:var(--muted) } .sv { font-size:22px; font-weight:600; margin-top:2px } .sv2 { font-size:17px; font-weight:600; margin-top:4px }
  .ss { font-size:12px; margin-top:2px }
  .legend { list-style:none; display:flex; gap:18px; margin:0; padding:0; font-size:12.5px; color:var(--muted) }
  .legend li { display:flex; align-items:center; gap:7px }
  .key { display:inline-block; width:14px; height:2px; border-radius:1px; vertical-align:middle; margin-right:6px }
  .legend .key { margin:0 } .key.value { background:var(--value) } .key.invested { background:var(--invested) }
  .chart { position:relative; min-width:0 }
  svg { display:block; touch-action:pan-y }
  .grid { stroke:var(--line); stroke-width:1 }
  .tick { fill:var(--faint); font-size:11px; font-variant-numeric:tabular-nums }
  .line { fill:none; stroke-width:2; stroke-linejoin:round; stroke-linecap:round }
  .line.value { stroke:var(--value) } .line.invested { stroke:var(--invested) }
  .cross { stroke:var(--line-strong); stroke-width:1 }
  .dot { stroke:var(--surface); stroke-width:2 } .dot.value { fill:var(--value) } .dot.invested { fill:var(--invested) }
  .tip { position:absolute; top:0; transform:translateX(-50%); pointer-events:none; background:var(--surface-2); border:1px solid var(--line-strong);
    border-radius:var(--radius-sm); padding:8px 10px; font-size:12.5px; line-height:1.55; white-space:nowrap; box-shadow:var(--shadow) }
  .td { color:var(--muted); font-size:11.5px }
  details summary { cursor:pointer; width:max-content }
  .table { margin-top:8px; max-height:320px; overflow-y:auto }
</style>
