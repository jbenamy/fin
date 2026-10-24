<!-- Status badge: always an icon + a word, never color alone. -->
<script lang="ts">
  import { CircleCheck, CircleX, Info, TriangleAlert } from "@lucide/svelte";
  let { tone = "info", label }: { tone?: "ok" | "warn" | "bad" | "info"; label: string } = $props();
  const Icon = $derived({ ok: CircleCheck, warn: TriangleAlert, bad: CircleX, info: Info }[tone]);
</script>

<span class="pill {tone}"><Icon size={13} strokeWidth={2.25} aria-hidden="true" />{label}</span>

<style>
  .pill { display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:500; padding:3px 9px 3px 7px; border-radius:99px; white-space:nowrap }
  .ok { color:var(--ok); background:var(--ok-soft) } .warn { color:var(--warn); background:var(--warn-soft) }
  .bad { color:var(--bad); background:var(--bad-soft) } .info { color:var(--accent); background:var(--accent-soft) }
</style>
