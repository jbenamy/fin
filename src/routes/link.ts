import { Router } from "express";
import { CountryCode, Products } from "plaid";
import { db } from "../db.js";
import { wrap } from "../http.js";
import { plaid } from "../plaid.js";
import { invalidatePlaidStatus } from "../plaidStatus.js";
import { isSyncRunning, syncAll, syncItem } from "../sync.js";
import type { ItemRow } from "../types.js";

export const link = Router();

link.post("/api/link-token", wrap(async (req, res) => {
  const base = {
    user: { client_user_id: "owner" },
    client_name: "Fin",
    country_codes: [CountryCode.Us],
    language: "en",
    redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
  };
  const itemId = req.body?.item_id as string | undefined;
  if (itemId) {
    // Update mode: grant an existing Item consent for Identity (owner detection).
    const item = db.prepare("SELECT access_token FROM items WHERE item_id = ?").get(itemId) as { access_token: string } | undefined;
    if (!item) return void res.status(404).json({ error: "unknown item" });
    const { data } = await plaid.linkTokenCreate({ ...base, access_token: item.access_token, additional_consented_products: [Products.Identity] });
    return void res.json({ link_token: data.link_token });
  }
  const { data } = await plaid.linkTokenCreate({
    ...base,
    products: [Products.Transactions],
    required_if_supported_products: [Products.Investments, Products.Identity],
    transactions: { days_requested: 730 },
  });
  res.json({ link_token: data.link_token });
}));

link.post("/api/exchange", wrap(async (req, res) => {
  const { public_token, institution } = req.body as { public_token: string; institution?: string };
  const { data } = await plaid.itemPublicTokenExchange({ public_token });
  db.prepare("INSERT OR REPLACE INTO items (item_id, access_token, institution, created_at) VALUES (?, ?, ?, ?)")
    .run(data.item_id, data.access_token, institution ?? "Unknown", new Date().toISOString());
  await syncItem({ item_id: data.item_id, access_token: data.access_token, cursor: null, identity_status: null });
  res.json({ ok: true });
}));

// After update-mode Link: retry owner detection and sync.
link.post("/api/item-updated", wrap(async (req, res) => {
  const item = db.prepare("SELECT item_id, access_token, cursor FROM items WHERE item_id = ?").get(String(req.body?.item_id ?? "")) as
    Pick<ItemRow, "item_id" | "access_token" | "cursor"> | undefined;
  if (!item) return void res.status(404).json({ error: "unknown item" });
  db.prepare("UPDATE items SET identity_status = NULL WHERE item_id = ?").run(item.item_id);
  invalidatePlaidStatus(item.item_id);
  await syncItem({ ...item, identity_status: null });
  res.json({ ok: true });
}));

// Streams progress as server-sent events (text/event-stream, which Caddy flushes immediately).
link.post("/api/sync", async (_req, res) => {
  if (isSyncRunning()) return void res.status(409).json({ error: "A sync is already running" });
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" }).flushHeaders();
  const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  try { await syncAll(send); } catch (e) { send({ event: "error", error: String(e) }); }
  res.end();
});
