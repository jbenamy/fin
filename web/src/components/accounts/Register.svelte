<!-- The transaction register: 100 rows at a time (lazy-loaded), optionally filtered by payee. The filter resets when the scope changes. -->
<script lang="ts">
  import { Search, X } from "@lucide/svelte";
  import { api, message } from "../../lib/api";
  import { data } from "../../lib/data.svelte";
  import { day, plural, usd } from "../../lib/format";
  import type { Transaction } from "../../lib/types";

  let { scope, names }: { scope: string; names: Record<string, string> | null } = $props(); // names: show an Account column

  type Cursor = { date: string; id: string };
  type Page = { rows: Transaction[]; next: Cursor | null };
  // status: "" once the first page is in, else "Loading…" or why it failed; moreFailed: a later page failed (retryable).
  let rows = $state<Transaction[]>([]), next = $state<Cursor | null>(null), status = $state("Loading…"), loading = $state(false), moreFailed = $state(false);
  // The filter belongs to the scope it was set in: switching account or owner clears it.
  let filterState = $state({ scope: "", payee: "", q: "" });
  const filter = $derived(filterState.scope === scope ? filterState : { scope, payee: "", q: "" });
  let seq = 0;

  const scopeParams = (id: string) => id.startsWith("o:") ? "owner=" + encodeURIComponent(id.slice(2)) : "account=" + encodeURIComponent(id);
  const txUrl = (cursor: Cursor | null) => "/api/transactions?limit=100&" + scopeParams(scope) +
    (filter.payee ? "&payee=" + encodeURIComponent(filter.payee) : "") + (filter.q ? "&q=" + encodeURIComponent(filter.q) : "") +
    (cursor ? `&before_date=${encodeURIComponent(cursor.date)}&before_id=${encodeURIComponent(cursor.id)}` : "");

  async function reload() {
    const mine = ++seq;
    status = "Loading…"; next = null; moreFailed = false;
    try {
      const page = await api<Page>(txUrl(null));
      if (mine !== seq) return; // a newer request superseded this one
      rows = page.rows; next = page.next; status = "";
    } catch (e) { if (mine === seq) { rows = []; status = "Couldn't load transactions: " + message(e); } }
  }
  async function more() {
    if (!next || loading || moreFailed) return;
    const mine = seq; loading = true;
    try {
      const page = await api<Page>(txUrl(next));
      if (mine !== seq) return;
      rows = [...rows, ...page.rows]; next = page.next;
    } catch { if (mine === seq) moreFailed = true; }
    finally { loading = false; }
  }

  // Reload on a new scope (read in txUrl), filter, or after a sync / edit (data.version).
  $effect(() => { void filter.payee; void filter.q; void data.version; reload(); });

  // Fetch further pages as the sentinel nears the viewport.
  function sentinel(el: HTMLElement) {
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { rootMargin: "400px" });
    io.observe(el);
    return { destroy: () => io.disconnect() };
  }
  // A sentinel still in view after a page loads (short page / tall window) needs another nudge.
  let sentinelEl = $state<HTMLElement>();
  $effect(() => { void rows.length; if (next && sentinelEl) { const r = sentinelEl.getBoundingClientRect(); if (r.top < innerHeight + 400) more(); } });

  // Payee typeahead: distinct payees with counts. Enter on a highlighted payee filters to exactly that payee;
  // Enter with plain text filters to any transaction containing it.
  let input = $state(""), open = $state(false), options = $state<{ payee: string; count: number }[]>([]), total = $state(0), active = $state(-1);
  let timer: ReturnType<typeof setTimeout> | undefined, reqSeq = 0;
  async function suggest() {
    const q = input.trim(), mine = ++reqSeq;
    try {
      const d = await api<{ payees: { payee: string; count: number }[]; total: number }>(`/api/payees?limit=12&${scopeParams(scope)}&q=${encodeURIComponent(q)}`);
      if (mine !== reqSeq) return;
      options = d.payees; total = d.total; active = -1; open = true;
    } catch {}
  }
  function apply(f: { payee: string; q: string }) { filterState = { scope, ...f }; input = ""; open = false; }
  function onkey(ev: KeyboardEvent) {
    if (ev.key === "ArrowDown") { ev.preventDefault(); if (!open) suggest(); else active = Math.min(active + 1, options.length - 1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); active = Math.max(active - 1, 0); }
    else if (ev.key === "Enter") { ev.preventDefault(); const q = input.trim(); if (active >= 0) apply({ payee: options[active].payee, q: "" }); else if (q) apply({ payee: "", q }); }
    else if (ev.key === "Escape") { if (open) open = false; else input = ""; }
  }
  function marked(name: string) {
    const q = input.trim(), i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
    return i < 0 ? [name, "", ""] : [name.slice(0, i), name.slice(i, i + q.length), name.slice(i + q.length)];
  }
  $effect(() => { if (active >= 0) document.getElementById("popt" + active)?.scrollIntoView({ block: "nearest" }); });

  const category = (c: string | null) => (c || "").replace(/_/g, " ").toLowerCase();
</script>

<div class="bar">
  <div class="search">
    <Search size={15} class="sicon" aria-hidden="true" />
    <input bind:value={input} role="combobox" aria-expanded={open} aria-controls="payeelist" aria-autocomplete="list" autocomplete="off" placeholder="Search payee…"
      aria-activedescendant={active >= 0 ? "popt" + active : undefined}
      oninput={() => { clearTimeout(timer); timer = setTimeout(suggest, 120); }} onfocus={suggest} onblur={() => { open = false; active = -1; }} onkeydown={onkey}>
    {#if open}
      <div class="plist card" id="payeelist" role="listbox">
        {#each options as p, n (p.payee)}
          {@const [a, b, c] = marked(p.payee)}
          <div class="popt" class:active={n === active} role="option" id={"popt" + n} aria-selected={n === active} tabindex="-1"
            onmousedown={(e) => { e.preventDefault(); apply({ payee: p.payee, q: "" }); }}>
            <span>{a}<mark>{b}</mark>{c}</span><span class="n">{p.count.toLocaleString()}</span>
          </div>
        {/each}
        {#if total > options.length}<div class="pnote">{(total - options.length).toLocaleString()} more — keep typing to narrow</div>{/if}
        {#if !options.length}<div class="pnote">No matching payees{input.trim() ? ` — press Enter to search “${input.trim()}”` : ""}</div>{/if}
      </div>
    {/if}
  </div>
  {#if filter.payee || filter.q}
    <span class="fchip">{filter.payee ? "Payee:" : "Contains:"} <b>{filter.payee || filter.q}</b>
      <button class="quiet icon sm" aria-label="Clear filter" onclick={() => apply({ payee: "", q: "" })}><X size={14} /></button></span>
  {/if}
</div>

<div class="card scroll-x">
  <table class="data">
    <thead><tr><th>Date</th>{#if names}<th>Account</th>{/if}<th>Payee</th><th>Category</th><th class="num">Amount</th></tr></thead>
    <tbody>
      {#each rows as t (t.transaction_id)}
        {@const amt = -t.amount /* Plaid: positive = money out */}
        <tr class:pending={t.pending}>
          <td class="muted date">{day(t.date)}</td>
          {#if names}<td class="muted">{names[t.account_id]}</td>{/if}
          <td class="payee">{t.merchant || t.name}{#if t.pending}<span class="tag">Pending</span>{/if}</td>
          <td>{#if t.category}<span class="cat">{category(t.category)}</span>{/if}</td>
          <td class="num" class:neg={amt < 0} class:pos={amt > 0}>{amt > 0 ? "+" : ""}{usd(amt)}</td>
        </tr>
      {:else}
        {#if !status}<tr><td colspan={names ? 5 : 4} class="muted">{filter.payee || filter.q ? "No matching transactions." : "No transactions yet."}</td></tr>{/if}
      {/each}
    </tbody>
  </table>
</div>
<div class="foot muted" bind:this={sentinelEl} use:sentinel>
  {#if moreFailed}Couldn't load more. <a href="#retry" onclick={(e) => { e.preventDefault(); moreFailed = false; more(); }}>Retry</a>
  {:else if status}{status}
  {:else if next || loading}Loading…
  {:else if rows.length}{plural(rows.length, "transaction")}{/if}
</div>

<style>
  .bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px }
  .search { position:relative; flex:1; min-width:220px; max-width:420px }
  .search :global(.sicon) { position:absolute; left:11px; top:50%; transform:translateY(-50%); color:var(--muted); pointer-events:none }
  .search input { width:100%; padding-left:33px; background:var(--surface) }
  .plist { position:absolute; left:0; right:0; top:calc(100% + 4px); z-index:20; box-shadow:0 14px 40px rgba(0,0,0,.4); max-height:340px; overflow:auto; padding:4px }
  .popt { display:flex; justify-content:space-between; gap:12px; padding:7px 10px; border-radius:6px; cursor:pointer } .popt.active, .popt:hover { background:var(--hover) }
  .popt .n { color:var(--muted); font-variant-numeric:tabular-nums } mark { background:none; color:var(--accent); font-weight:600 }
  .pnote { padding:7px 10px; color:var(--muted); font-size:12px }
  .fchip { display:inline-flex; align-items:center; gap:6px; background:var(--accent-soft); color:var(--accent-strong); border-radius:99px; padding:3px 4px 3px 12px; font-size:13px }
  .date { white-space:nowrap } .payee { font-weight:500 }
  .cat { font-size:12px; color:var(--muted); background:var(--surface-2); border:1px solid var(--line); padding:1px 8px; border-radius:99px; white-space:nowrap }
  .tag { margin-left:8px; font-size:11px; color:var(--warn); background:var(--warn-soft); padding:1px 7px; border-radius:99px }
  tr.pending td { opacity:.6 }
  .foot { text-align:center; padding:14px; font-size:12px }
</style>
