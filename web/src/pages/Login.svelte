<!-- /login: sign in with a passkey, create the very first one, or add one from an invite link. -->
<script lang="ts">
  import { FingerprintPattern, KeyRound, LoaderCircle, TriangleAlert } from "@lucide/svelte";
  import { api, message } from "../lib/api";
  import { registerPasskey, signInWithPasskey, supported } from "../lib/webauthn";

  const params = new URLSearchParams(location.search);
  const invite = params.get("invite");
  // Only same-site paths: "//host" or "/\host" would leave the app.
  const next = /^\/(?![/\\])/.test(params.get("next") ?? "") ? params.get("next")! : "/";

  type View = "loading" | "unsupported" | "expired" | "invite" | "setup" | "signin";
  let view = $state<View>("loading"), label = $state(""), busy = $state(false), error = $state("");

  async function run(fn: () => Promise<unknown>) {
    error = ""; busy = true;
    try { await fn(); location.replace(next); }
    catch (e) { error = message(e); busy = false; }
  }

  (async () => {
    if (!supported()) { view = "unsupported"; return; }
    const status = await api("/api/auth/status" + (invite ? "?invite=" + encodeURIComponent(invite) : ""));
    if (invite) view = status.invite ? "invite" : "expired";
    else if (status.signedIn) location.replace(next);
    else view = status.setup ? "setup" : "signin";
  })().catch((e) => { error = message(e); view = "signin"; });

  const focus = (el: HTMLElement) => el.focus();
</script>

<main class="wrap">
  <div class="box card">
    <div class="brand"><img src="/favicon.svg" alt="" width="40" height="40"><span>Fin</span></div>
    {#if view === "loading"}
      <p class="muted center"><LoaderCircle size={18} class="spin" aria-hidden="true" /></p>
    {:else if view === "unsupported"}
      <h1>Passkeys unavailable</h1><p class="muted">This browser doesn't support passkeys.</p>
    {:else if view === "expired"}
      <h1><TriangleAlert size={18} color="var(--warn)" aria-hidden="true" />Invite link expired</h1>
      <p class="muted">This link was already used or is more than a day old. Ask someone who is signed in for a new one.</p>
    {:else if view === "invite" || view === "setup"}
      <h1>{view === "invite" ? "Add a passkey" : "Set up Fin"}</h1>
      <p class="muted">{view === "invite" ? "You were invited to Fin. Create a passkey on this device to sign in from now on."
        : "No passkey exists yet. Create the first one; after that, new passkeys need an invite from someone signed in."}</p>
      <form onsubmit={(e) => { e.preventDefault(); run(() => registerPasskey(label, invite)); }}>
        <label class="field">Name for this passkey<input bind:value={label} use:focus maxlength="60" autocomplete="off" required placeholder="e.g. Alex's iPhone"></label>
        <button type="submit" disabled={busy}><KeyRound size={16} aria-hidden="true" />Create passkey</button>
      </form>
    {:else}
      <h1>Sign in</h1>
      <p class="muted">Use the passkey you created for Fin.</p>
      <button class="full" use:focus disabled={busy} onclick={() => run(signInWithPasskey)}><FingerprintPattern size={17} aria-hidden="true" />Sign in with a passkey</button>
    {/if}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </div>
</main>

<style>
  .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px 16px;
    background:radial-gradient(800px 400px at 50% -10%, rgba(139,143,255,.12), transparent 70%) }
  .box { width:min(380px, 100%); padding:28px }
  .brand { display:flex; align-items:center; gap:12px; font-weight:700; font-size:22px; margin-bottom:22px }
  h1 { display:flex; align-items:center; gap:8px; font-size:18px; margin-bottom:6px }
  p { font-size:13.5px; line-height:1.55; margin:0 0 18px } .center { text-align:center; margin:12px 0 }
  form { display:flex; flex-direction:column; gap:14px }
  button { padding:10px 14px } .full { width:100% }
  .err { margin:14px 0 0 }
</style>
