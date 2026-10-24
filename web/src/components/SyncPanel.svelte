<!-- Progress and results of "Sync now", shown above the page content until dismissed. -->
<script lang="ts">
  import { CircleCheck, CircleX, LoaderCircle, X } from "@lucide/svelte";
  import { plural } from "../lib/format";
  import { sync, type SyncResult } from "../lib/sync.svelte";

  const summary = (r: SyncResult) => [
    plural(r.accounts, "account"),
    `${r.added} new · ${r.modified} updated · ${r.removed} removed transactions`,
    r.holdings ? plural(r.holdings, "holding") : "",
  ].filter(Boolean).join(" · ");
</script>

{#if sync.open}
  <section class="sync card" aria-live="polite">
    <div class="head">
      {#if sync.running}<LoaderCircle size={16} class="spin" aria-hidden="true" />{:else if sync.error}<CircleX size={16} color="var(--bad)" aria-hidden="true" />{:else}<CircleCheck size={16} color="var(--ok)" aria-hidden="true" />{/if}
      <h2>{sync.running ? "Syncing…" : sync.error ? "Sync failed" : "Sync complete"}</h2>
      {#if !sync.running}<button class="quiet icon sm" aria-label="Dismiss" onclick={() => (sync.open = false)}><X size={15} /></button>{/if}
    </div>
    {#if sync.error}<p class="err">{sync.error}</p>{/if}
    <ul>
      {#each sync.rows as r (r.name)}
        <li class:fail={r.result && !r.result.ok}>
          <b>{r.name}</b>
          <span class="muted">{r.result ? (r.result.ok ? summary(r.result) : r.result.error) : (r.detail ?? "Waiting…")}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .sync { padding:14px 16px; margin:0 0 20px }
  .head { display:flex; align-items:center; gap:8px } h2 { font-size:14px; flex:1 }
  ul { list-style:none; margin:8px 0 0; padding:0; display:grid; gap:4px; font-size:13px }
  li { display:flex; gap:8px; flex-wrap:wrap } li.fail .muted { color:var(--bad) }
</style>
