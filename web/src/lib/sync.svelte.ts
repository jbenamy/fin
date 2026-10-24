// "Sync now": streams per-bank progress from the server (server-sent events over a POST response).
import { message } from "./api";
import { changed } from "./data.svelte";

export interface SyncResult {
  institution: string; ok: boolean; error?: string; accounts: number; registerAccounts: number; balanceOnlyAccounts: number;
  added: number; modified: number; removed: number; holdings: number;
}
type Row = { name: string; detail?: string; result?: SyncResult };

export const sync = $state({ running: false, open: false, error: "", rows: [] as Row[] });

async function* events(response: Response) {
  const reader = response.body!.getReader(), decoder = new TextDecoder();
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

const row = (name: string) => { let r = sync.rows.find((x) => x.name === name); if (!r) { r = { name }; sync.rows.push(r); } return r; };

export async function startSync() {
  if (sync.running) return;
  Object.assign(sync, { running: true, open: true, error: "", rows: [] });
  try {
    const res = await fetch("/api/sync", { method: "POST" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    for await (const e of events(res)) {
      if (e.event === "start") for (const name of e.institutions) row(name);
      else if (e.event === "phase") row(e.institution).detail = e.detail;
      else if (e.event === "item_done") row(e.result.institution).result = e.result;
      else if (e.event === "error") throw new Error(e.error);
    }
  } catch (e) { sync.error = message(e); }
  sync.running = false;
  await changed();
}
