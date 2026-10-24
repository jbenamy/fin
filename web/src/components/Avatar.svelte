<!-- Monogram for a person or an institution. The hue comes from the name, so it is stable across pages. -->
<script lang="ts">
  import { initials } from "../lib/format";
  let { name, size = 32, square = false }: { name: string; size?: number; square?: boolean } = $props();
  const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

<span class="av" class:square style="--s:{size}px; --h:{hue}" aria-hidden="true">{initials(name) || "?"}</span>

<style>
  .av { display:inline-flex; align-items:center; justify-content:center; flex:none; width:var(--s); height:var(--s); border-radius:50%;
    font-size:calc(var(--s) * .38); font-weight:650; letter-spacing:.02em; color:hsl(var(--h) 70% 82%); background:hsl(var(--h) 35% 24%) }
  .square { border-radius:calc(var(--s) * .28) }
</style>
