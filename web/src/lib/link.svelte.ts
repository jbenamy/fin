// Plaid Link: connect a new bank.
// Banks that use OAuth send the browser back to /accounts, where resumeOAuth() reopens Link.
import { api, message } from "./api";
import { changed } from "./data.svelte";
import { navigate } from "./router.svelte";
import { store } from "./store";

declare const Plaid: { create(options: Record<string, unknown>): { open(): void } };

export const linking = $state({ busy: false });

// Plaid's script (it can't be bundled) loads in the background once the signed-in app is up, so Link opens without
// a wait; the login page never loads it.
let script: Promise<void> | null = null;
export const loadPlaid = () => script ??= new Promise<void>((resolve, reject) => {
  const s = document.createElement("script");
  s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
  s.onload = () => resolve(); s.onerror = () => { script = null; reject(new Error("Couldn't load Plaid Link")); };
  document.head.append(s);
});

/** Open Link for a new bank. */
export async function startLink() {
  try {
    const [{ link_token }] = await Promise.all([api<{ link_token: string }>("/api/link-token", { method: "POST", json: {} }), loadPlaid()]);
    openLink(link_token);
  } catch (e) { alert(message(e)); }
}

function openLink(token: string, receivedRedirectUri?: string) {
  // Persist enough context to resume after an OAuth redirect.
  if (!receivedRedirectUri) store.set("link_ctx", JSON.stringify({ token }));
  const finish = () => { store.remove("link_ctx"); if (location.search.includes("oauth_state_id")) navigate("/accounts" + location.hash, true); };
  Plaid.create({
    token, receivedRedirectUri,
    onSuccess: async (public_token: string, meta: { institution?: { name?: string } }) => {
      finish();
      linking.busy = true;
      try {
        await api("/api/exchange", { method: "POST", json: { public_token, institution: meta.institution?.name } });
      } catch (e) { alert(message(e)); }
      linking.busy = false;
      await changed();
    },
    onExit: finish,
  }).open();
}

/** If the browser just came back from a bank's OAuth page, reopen Link where it left off. */
export async function resumeOAuth() {
  if (!location.search.includes("oauth_state_id")) return;
  const received = location.href; // exactly what Plaid redirected to, before anything else changes the address
  try {
    const ctx = JSON.parse(store.get("link_ctx") ?? "null");
    if (ctx) { await loadPlaid(); openLink(ctx.token, received); }
  } catch {}
}
