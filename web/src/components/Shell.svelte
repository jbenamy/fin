<!-- The frame around every signed-in page: a nav rail on wide screens, a top bar + bottom tabs on phones. -->
<script lang="ts">
  import { KeyRound, LayoutDashboard, LogOut, Plug, Plus, RefreshCw, Wallet } from "@lucide/svelte";
  import { onMount, type Snippet } from "svelte";
  import { signOut } from "../lib/api";
  import { lastSynced } from "../lib/data.svelte";
  import { ago } from "../lib/format";
  import { linking, loadPlaid, startLink } from "../lib/link.svelte";
  import { route } from "../lib/router.svelte";
  import { startSync, sync } from "../lib/sync.svelte";
  import SyncPanel from "./SyncPanel.svelte";

  let { children }: { children: Snippet } = $props();

  const NAV = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/accounts", label: "Accounts", icon: Wallet },
    { href: "/connections", label: "Connections", icon: Plug },
    { href: "/passkeys", label: "Passkeys", icon: KeyRound },
  ];
  const synced = $derived(lastSynced());

  onMount(() => { const t = setTimeout(() => loadPlaid().catch(() => {}), 1500); return () => clearTimeout(t); });
</script>

<div class="shell">
  <nav class="rail" aria-label="Main">
    <a href="/" class="brand"><img src="/favicon.svg" alt="" width="28" height="28"><span>Fin</span></a>
    <ul>
      {#each NAV as n (n.href)}
        <li><a href={n.href} aria-current={route.path === n.href ? "page" : undefined}><n.icon size={18} aria-hidden="true" />{n.label}</a></li>
      {/each}
    </ul>
    <div class="rail-foot">
      <button onclick={() => startLink()} disabled={linking.busy}><Plus size={16} aria-hidden="true" />{linking.busy ? "Adding…" : "Connect bank"}</button>
      <button class="ghost" onclick={startSync} disabled={sync.running}><RefreshCw size={15} class={sync.running ? "spin" : ""} aria-hidden="true" />{sync.running ? "Syncing…" : "Sync now"}</button>
      <p class="faint small">{synced ? `Synced ${ago(synced)}` : "Not synced yet"}</p>
      <button class="quiet signout" onclick={signOut}><LogOut size={15} aria-hidden="true" />Sign out</button>
    </div>
  </nav>

  <header class="topbar">
    <a href="/" class="brand"><img src="/favicon.svg" alt="" width="26" height="26"><span>Fin</span></a>
    <button class="ghost icon" aria-label="Sync now" onclick={startSync} disabled={sync.running}><RefreshCw size={17} class={sync.running ? "spin" : ""} /></button>
    <button class="icon" aria-label="Connect bank" onclick={() => startLink()} disabled={linking.busy}><Plus size={17} /></button>
  </header>

  <main class="content">
    <div class="page"><SyncPanel />{@render children()}</div>
  </main>

  <nav class="tabs" aria-label="Main">
    {#each NAV as n (n.href)}
      <a href={n.href} aria-current={route.path === n.href ? "page" : undefined}><n.icon size={20} aria-hidden="true" /><span>{n.label}</span></a>
    {/each}
  </nav>
</div>

<style>
  .shell { min-height:100vh }
  .rail { position:fixed; inset:0 auto 0 0; width:var(--nav-w); display:flex; flex-direction:column; padding:18px 14px; background:var(--surface); border-right:1px solid var(--line); z-index:10 }
  .brand { display:flex; align-items:center; gap:10px; padding:4px 8px 18px; font-weight:700; font-size:18px; color:var(--fg); text-decoration:none }
  .rail ul { list-style:none; margin:0; padding:0; display:grid; gap:2px }
  .rail ul a { display:flex; align-items:center; gap:11px; padding:9px 10px; border-radius:var(--radius-sm); color:var(--muted); text-decoration:none; font-weight:500 }
  .rail ul a:hover { background:var(--hover); color:var(--fg) }
  .rail ul a[aria-current="page"] { background:var(--accent-soft); color:var(--accent-strong) }
  .rail-foot { margin-top:auto; display:grid; gap:8px }
  .rail-foot p { margin:0 0 4px; text-align:center }
  .signout { justify-content:flex-start; padding-left:10px; border-top:1px solid var(--line); border-radius:0; padding-top:12px; margin-top:4px }
  .signout:hover { background:none }

  .content { margin-left:var(--nav-w) }
  .page { max-width:var(--page-max); margin:0 auto; padding:32px 36px 64px }

  .topbar, .tabs { display:none }
  @media (max-width: 820px) {
    .rail { display:none }
    .content { margin-left:0 }
    .page { padding:20px 16px calc(88px + env(safe-area-inset-bottom)) }
    .topbar { display:flex; align-items:center; gap:8px; position:sticky; top:0; z-index:10; padding:10px 16px; background:rgba(15,17,22,.92); backdrop-filter:blur(8px); border-bottom:1px solid var(--line) }
    .topbar .brand { padding:0; margin-right:auto; font-size:17px }
    .tabs { display:grid; grid-template-columns:repeat(4, 1fr); position:fixed; inset:auto 0 0 0; z-index:10; background:rgba(22,25,33,.96); backdrop-filter:blur(8px); border-top:1px solid var(--line); padding:6px 4px calc(6px + env(safe-area-inset-bottom)) }
    .tabs a { display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 2px; font-size:11px; color:var(--muted); text-decoration:none; border-radius:var(--radius-sm) }
    .tabs a[aria-current="page"] { color:var(--accent-strong) }
  }
</style>
