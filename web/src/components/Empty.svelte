<script lang="ts">
  import type { Component, Snippet } from "svelte";
  let { icon: Icon, title, children }: { icon: Component<any>; title: string; children?: Snippet } = $props();
</script>

<div class="empty card">
  <span class="ic"><Icon size={26} strokeWidth={1.75} aria-hidden="true" /></span>
  <h2>{title}</h2>
  {#if children}<div class="muted">{@render children()}</div>{/if}
</div>

<style>
  .empty { display:flex; flex-direction:column; align-items:center; gap:8px; text-align:center; padding:48px 20px }
  .ic { display:inline-flex; padding:14px; border-radius:16px; background:var(--accent-soft); color:var(--accent); margin-bottom:4px }
  h2 { font-size:16px } .muted { font-size:13.5px; max-width:420px }
</style>
