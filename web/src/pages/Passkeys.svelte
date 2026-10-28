<!-- /passkeys: the passkeys that can sign in, adding one here or via an invite link, removing one, signing out. -->
<script lang="ts">
  import { KeyRound, LogOut, Plus, Send, Trash } from "@lucide/svelte";
  import Dialog from "../components/Dialog.svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import Pill from "../components/Pill.svelte";
  import { api, message, signOut } from "../lib/api";
  import { cmp, dateTime, shortDate } from "../lib/format";
  import type { Passkey } from "../lib/types";
  import { registerPasskey } from "../lib/webauthn";

  let passkeys = $state<Passkey[]>([]), loaded = $state(false), error = $state("");
  const sorted = $derived([...passkeys].sort((a, b) => cmp(a.label, b.label)));

  async function load() {
    try { passkeys = await api<Passkey[]>("/api/passkeys"); error = ""; } catch (e) { error = message(e); }
    loaded = true;
  }
  load();

  // Add on this device
  let addOpen = $state(false), addLabel = $state(""), addErr = $state(""), adding = $state(false);
  async function add() {
    adding = true; addErr = "";
    try { await registerPasskey(addLabel); addOpen = false; await load(); } catch (e) { addErr = message(e); }
    adding = false;
  }

  // Invite link
  let invOpen = $state(false), invUrl = $state(""), invUntil = $state(""), copied = $state(false), invInput = $state<HTMLInputElement>();
  async function invite() {
    try {
      const r = await api<{ url: string; expires_at: string }>("/api/passkeys/invite", { method: "POST" });
      invUrl = r.url; invUntil = dateTime(r.expires_at); copied = false; invOpen = true;
      setTimeout(() => invInput?.select());
    } catch (e) { error = message(e); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(invUrl); copied = true; } catch { invInput?.select(); }
  }

  // Remove
  let rm = $state<Passkey | null>(null), rmOpen = $state(false), rmErr = $state("");
  async function remove() {
    try { await api("/api/passkeys/" + encodeURIComponent(rm!.id), { method: "DELETE" }); rmOpen = false; await load(); }
    catch (e) { rmErr = message(e); }
  }
</script>

<PageHeader title="Passkeys" subtitle="Any passkey listed here can sign in to Fin.">
  {#snippet actions()}
    <button onclick={() => { addLabel = ""; addErr = ""; addOpen = true; }}><Plus size={16} aria-hidden="true" />Add passkey on this device</button>
    <button class="ghost" onclick={invite} title="A one-time link to add a passkey on another device"><Send size={15} aria-hidden="true" />Invite link</button>
    <button class="ghost signout" onclick={signOut}><LogOut size={15} aria-hidden="true" />Sign out</button>
  {/snippet}
</PageHeader>

{#if error}<p class="err">{error}</p>{/if}

<div class="card scroll-x">
  <table class="data">
    <thead><tr><th>Name</th><th class="hide-sm">Added</th><th>Last used</th><th></th></tr></thead>
    <tbody>
      {#if !loaded}<tr><td colspan="4" class="muted">Loading…</td></tr>{/if}
      {#each sorted as p (p.id)}
        <tr>
          <td><span class="name"><span class="key"><KeyRound size={15} aria-hidden="true" /></span>{p.label}{#if p.current}<Pill tone="ok" label="This browser" />{/if}</span></td>
          <td class="hide-sm muted">{shortDate(p.created_at)}</td>
          <td class="muted">{shortDate(p.last_used)}</td>
          <td class="num">{#if passkeys.length > 1}<button class="quiet danger sm" onclick={() => { rm = p; rmErr = ""; rmOpen = true; }}><Trash size={14} aria-hidden="true" />Remove</button>{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<Dialog bind:open={addOpen} title="Add passkey on this device" onsubmit={add}>
  <label class="field">Name<input bind:value={addLabel} maxlength="60" autocomplete="off" required placeholder="e.g. Sam's laptop"></label>
  {#if addErr}<p class="err">{addErr}</p>{/if}
  {#snippet actions()}<button type="submit" disabled={adding}>Create passkey</button>{/snippet}
</Dialog>

<Dialog bind:open={invOpen} title="Invite link" cancelLabel="Close" onsubmit={copy}>
  <label class="field">Open this on the other device to create a passkey there<input class="mono" bind:this={invInput} value={invUrl} readonly></label>
  <p class="hint">Works once, until {invUntil}.</p>
  {#snippet actions()}<button type="submit">{copied ? "Copied" : "Copy"}</button>{/snippet}
</Dialog>

<Dialog bind:open={rmOpen} title={`Remove "${rm?.label ?? ""}"?`} onsubmit={remove}>
  <p>It will no longer sign in to Fin, and browsers signed in with it are signed out. Also delete it from the device's password manager.</p>
  {#if rmErr}<p class="err">{rmErr}</p>{/if}
  {#snippet actions()}<button type="submit" class="danger">Remove</button>{/snippet}
</Dialog>

<style>
  .name { display:inline-flex; align-items:center; gap:10px; flex-wrap:wrap; font-weight:500 }
  .key { display:inline-flex; padding:6px; border-radius:8px; background:var(--accent-soft); color:var(--accent) }
  .mono { font-family:ui-monospace, monospace; font-size:12px }
  @media (max-width:560px) { .hide-sm { display:none } }
  @media (min-width:821px) { .signout { display:none } } /* the nav rail has Sign out; phones only have this one */
</style>
