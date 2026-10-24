<!-- The same header on every page: title, optional subtitle, actions on the right. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  let { title, subtitle, actions }: { title: string; subtitle?: Snippet | string; actions?: Snippet } = $props();
</script>

<header class="ph">
  <div>
    <h1>{title}</h1>
    {#if typeof subtitle === "string"}<p class="muted">{subtitle}</p>{:else if subtitle}<p class="muted">{@render subtitle()}</p>{/if}
  </div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
  .ph { display:flex; align-items:flex-end; justify-content:space-between; gap:12px 20px; flex-wrap:wrap; margin:0 0 24px }
  h1 { font-size:24px; line-height:1.2 }
  p { margin:4px 0 0; font-size:13.5px }
  .actions { display:flex; gap:8px; flex-wrap:wrap }
</style>
