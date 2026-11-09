<!-- /about: Fin's version and commit, and the versions of everything it runs on (from /api/about). -->
<script lang="ts">
  import { Check, Copy } from "@lucide/svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import { api, message } from "../lib/api";
  import { cmp, dateTime } from "../lib/format";
  import type { About } from "../lib/types";

  let about = $state<About | null>(null), error = $state(""), copied = $state(false);
  api<About>("/api/about").then((a) => (about = a), (e) => (error = message(e)));

  const PART = { server: "Server", "server-dev": "Server (dev)", web: "Web" } as const;
  const partOf = (p: About["packages"][number]) => (p.part === "web" ? PART.web : p.dev ? PART["server-dev"] : PART.server);
  const ORDER: string[] = [PART.server, PART["server-dev"], PART.web];
  const packages = $derived([...(about?.packages ?? [])].sort((a, b) => ORDER.indexOf(partOf(a)) - ORDER.indexOf(partOf(b)) || cmp(a.name, b.name)));

  const fin = $derived(about ? [
    { label: "Version", value: about.version },
    { label: "Commit", value: about.commit },
    { label: "Built", value: about.built_at && dateTime(about.built_at) },
    { label: "Server started", value: dateTime(about.started_at) },
  ] : []);

  // Plain text for bug reports and notes.
  async function copy() {
    if (!about) return;
    const line = (r: { label: string; value: string | null }) => `${r.label}: ${r.value ?? "unknown"}`;
    const text = [
      "Fin", ...fin.map(line), "", "Runtime", ...about.runtime.map(line), "", "Plaid", ...about.plaid.map(line), "", "Packages",
      ...packages.map((p) => `${p.name} ${p.version ?? "not installed"} (${partOf(p)})`),
    ].join("\n");
    try { await navigator.clipboard.writeText(text); copied = true; setTimeout(() => (copied = false), 2000); } catch (e) { error = message(e); }
  }
</script>

<PageHeader title="About" subtitle={about ? `Fin ${about.version ?? ""}${about.commit ? ` · ${about.commit}` : ""}` : "Versions of Fin and everything it runs on."}>
  {#snippet actions()}
    <button class="ghost" onclick={copy} disabled={!about}>
      {#if copied}<Check size={15} aria-hidden="true" />Copied{:else}<Copy size={15} aria-hidden="true" />Copy versions{/if}
    </button>
  {/snippet}
</PageHeader>

{#if error}<p class="err">{error}</p>{/if}

{#if !about && !error}
  <p class="muted">Loading…</p>
{:else if about}
  <div class="grid">
    {#each [{ title: "Fin", rows: fin }, { title: "Runtime", rows: about.runtime }, { title: "Plaid", rows: about.plaid }] as s (s.title)}
      <section>
        <h2 class="section-title">{s.title}</h2>
        <dl class="card card-pad">
          {#each s.rows as r (r.label)}<dt>{r.label}</dt><dd>{r.value ?? "—"}</dd>{/each}
        </dl>
      </section>
    {/each}
  </div>

  <h2 class="section-title">Packages</h2>
  {#if packages.length}
    <div class="card scroll-x">
      <table class="data">
        <thead><tr><th>Package</th><th>Installed</th><th class="hide-sm">Requested</th><th class="hide-sm">Used by</th></tr></thead>
        <tbody>
          {#each packages as p (p.part + p.name)}
            <tr>
              <td><span class="mono">{p.name}</span><small class="show-sm">{partOf(p)}</small></td>
              <td class="mono num">{p.version ?? "not installed"}</td>
              <td class="mono muted hide-sm">{p.wanted}</td>
              <td class="muted nowrap hide-sm">{partOf(p)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="muted">No build info: package versions are recorded by <code>pnpm build</code>.</p>
  {/if}
{/if}

<style>
  .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(330px, 1fr)); gap:20px; margin-bottom:28px }
  dl { display:grid; grid-template-columns:auto 1fr; gap:9px 16px; margin:0; font-size:13.5px }
  dt { color:var(--muted) }
  dd { margin:0; text-align:right; font-variant-numeric:tabular-nums; overflow-wrap:break-word; min-width:0 }
  .nowrap { white-space:nowrap }
  .mono { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12.5px }
  .show-sm { display:none }
  @media (max-width: 600px) { .hide-sm { display:none } table.data td small.show-sm { display:block } }
</style>
