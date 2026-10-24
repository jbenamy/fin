<script lang="ts">
  // `onchange` may return a promise: the switch is disabled meanwhile, and flips back if it resolves to false.
  let { checked = $bindable(false), label, disabled = false, onchange }: {
    checked?: boolean; label: string; disabled?: boolean; onchange?: (checked: boolean) => unknown;
  } = $props();
  let busy = $state(false);
  async function change() {
    busy = true;
    if ((await onchange?.(checked)) === false) checked = !checked;
    busy = false;
  }
</script>

<label class="switch" title={label}>
  <input type="checkbox" role="switch" aria-label={label} bind:checked disabled={disabled || busy} onchange={change}><span></span>
</label>

<style>
  .switch { position:relative; display:inline-block; width:34px; height:20px; flex:none }
  input { opacity:0; width:100%; height:100%; margin:0; position:absolute; cursor:pointer; z-index:1 }
  span { position:absolute; inset:0; background:var(--line-strong); border-radius:99px; transition:background .15s }
  span::after { content:""; position:absolute; top:2px; left:2px; width:16px; height:16px; background:#fff; border-radius:50%; transition:transform .15s }
  input:checked + span { background:var(--accent) } input:checked + span::after { transform:translateX(14px) }
  input:focus-visible + span { outline:2px solid var(--accent); outline-offset:2px }
  input:disabled + span { opacity:.5 }
</style>
