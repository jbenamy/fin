// Plaid Link: connect a new bank, or re-grant consent on an existing connection (update mode).
// Banks that use OAuth send the browser back to /accounts, where resumeOAuth() reopens Link.
import { $, api, store } from "/shared.js";

let onLinked = () => {};

/** Wire the "Connect bank" button. `done` runs after a connection is added or updated. */
export function initLink(done) { onLinked = done; $("#link").onclick = () => startLink(); }

/** Open Link for a new bank, or in update mode when `updateItemId` is given. */
export async function startLink(updateItemId) {
  try {
    const { link_token } = await api("/api/link-token", { method: "POST", json: updateItemId ? { item_id: updateItemId } : {} });
    openLink(link_token, undefined, updateItemId);
  } catch (e) { alert(e.message); }
}

function openLink(token, receivedRedirectUri, updateItemId) {
  // Persist enough context to resume after an OAuth redirect.
  if (!receivedRedirectUri) store.set("link_ctx", JSON.stringify({ token, updateItemId: updateItemId ?? null }));
  const finish = () => { store.remove("link_ctx"); history.replaceState({}, "", "/accounts"); };
  // `Plaid` is the global from Plaid's Link script.
  Plaid.create({
    token, receivedRedirectUri,
    onSuccess: async (public_token, meta) => {
      finish();
      try {
        if (updateItemId) await api("/api/item-updated", { method: "POST", json: { item_id: updateItemId } });
        else {
          $("#link").textContent = "Syncing…";
          await api("/api/exchange", { method: "POST", json: { public_token, institution: meta.institution?.name } });
        }
      } catch (e) { alert(e.message); }
      $("#link").textContent = "+ Connect bank"; onLinked();
    },
    onExit: finish,
  }).open();
}

/** If the browser just came back from a bank's OAuth page, reopen Link where it left off. */
export function resumeOAuth() {
  if (!location.search.includes("oauth_state_id")) return;
  try {
    const ctx = JSON.parse(store.get("link_ctx") ?? "null");
    if (ctx) openLink(ctx.token, location.href, ctx.updateItemId ?? undefined);
  } catch {}
}
