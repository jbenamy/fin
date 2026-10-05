// "Sync now": streams per-bank progress from the server and shows it in #syncpanel.
import { $, esc, plural } from "/shared.js";

/** Parse the server-sent-event stream of a fetch response into JSON events. */
async function* events(response) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const line = buffer.slice(0, end).replace(/^data: /, ""); buffer = buffer.slice(end + 2);
      yield JSON.parse(line);
    }
  }
}

function summary(r) {
  if (!r.ok) return `✗ ${esc(r.error)}`;
  return `✓ ${plural(r.accounts, "account")} · ${r.added} new, ${r.modified} updated, ${r.removed} removed transactions` +
    (r.brokerageAccounts ? ` · ${plural(r.brokerageAccounts, "brokerage account")} (balance only)` : "") +
    (r.ownersDetected ? ` · ${plural(r.ownersDetected, "owner")} detected` : "");
}

function showSync(state) {
  const rows = Object.entries(state.items).map(([name, it]) =>
    `<li><b>${esc(name)}</b>: ${it.result ? summary(it.result) : esc(it.detail || "waiting…")}</li>`).join("");
  $("#syncpanel").innerHTML = `<div class="sync"><h3>${state.finished ? "Sync complete" : "Syncing…"}</h3><ul>${rows}</ul></div>`;
}

/** Wire the Sync button; `done` runs afterwards so the page can reload its data. */
export function initSync(done) {
  const button = $("#sync");
  button.onclick = async () => {
    button.disabled = true; button.textContent = "Syncing…";
    const state = { items: {}, finished: false };
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error);
      for await (const e of events(res)) {
        if (e.event === "start") for (const name of e.institutions) state.items[name] = {};
        else if (e.event === "phase") state.items[e.institution] = { ...state.items[e.institution], detail: e.detail };
        else if (e.event === "item_done") state.items[e.result.institution] = { result: e.result };
        else if (e.event === "done") state.finished = true;
        else if (e.event === "error") throw new Error(e.error);
        showSync(state);
      }
      state.finished = true; showSync(state);
    } catch (e) { $("#syncpanel").innerHTML = `<div class="sync err">Sync failed: ${esc(e.message)}</div>`; }
    button.disabled = false; button.textContent = "Sync now"; done();
  };
}
