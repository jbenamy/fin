<!-- A modal form. Escape / Cancel close it; submitting runs `onsubmit` (the dialog stays open until the caller closes it). -->
<script lang="ts">
  import type { Snippet } from "svelte";
  let { open = $bindable(false), title, cancelLabel = "Cancel", onsubmit, children, actions }: {
    open?: boolean; title: string; cancelLabel?: string; onsubmit?: () => unknown; children?: Snippet; actions: Snippet;
  } = $props();
  let dlg: HTMLDialogElement;
  $effect(() => { if (open && !dlg.open) dlg.showModal(); else if (!open && dlg.open) dlg.close(); });
</script>

<dialog bind:this={dlg} onclose={() => (open = false)}>
  <form method="dialog" onsubmit={(e) => { e.preventDefault(); onsubmit?.(); }}>
    <h3>{title}</h3>
    {@render children?.()}
    <div class="actions">
      <button type="button" class="ghost" onclick={() => (open = false)}>{cancelLabel}</button>
      {@render actions()}
    </div>
  </form>
</dialog>

<style>
  dialog { border:1px solid var(--line-strong); border-radius:16px; padding:0; background:var(--surface); color:var(--fg); width:min(440px, calc(100vw - 32px)); box-shadow:0 24px 60px rgba(0,0,0,.45) }
  dialog::backdrop { background:rgba(6,8,12,.6); backdrop-filter:blur(2px) }
  form { padding:22px; display:flex; flex-direction:column; gap:14px }
  h3 { font-size:16px; overflow-wrap:anywhere }
  .actions { display:flex; justify-content:flex-end; gap:8px; margin-top:4px }
  :global(dialog p) { margin:0; font-size:13.5px; line-height:1.55 }
</style>
