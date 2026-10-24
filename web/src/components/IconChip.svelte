<!-- An icon on a tinted square, used for account groups and headline tiles. -->
<script lang="ts">
  import type { Component } from "svelte";
  let { icon: Icon, tone = "accent", size = 34 }: { icon: Component<any>; tone?: "accent" | "ok" | "warn" | "bad" | "neutral"; size?: number } = $props();
</script>

<span class="chip {tone}" style="--s:{size}px" aria-hidden="true"><Icon size={Math.round(size * 0.5)} strokeWidth={2} /></span>

<style>
  .chip { display:inline-flex; align-items:center; justify-content:center; flex:none; width:var(--s); height:var(--s); border-radius:calc(var(--s) * .3) }
  .accent { color:var(--accent); background:var(--accent-soft) } .ok { color:var(--ok); background:var(--ok-soft) }
  .warn { color:var(--warn); background:var(--warn-soft) } .bad { color:var(--bad); background:var(--bad-soft) }
  .neutral { color:var(--muted); background:var(--surface-2) }
</style>
