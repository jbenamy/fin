import { Router } from "express";
import { CountryCode, Products } from "plaid";
import { db } from "../db.js";
import { plaid } from "../plaid.js";
import { isSyncRunning, syncAll, syncItem } from "../sync.js";

export const link = Router();

link.post("/api/link-token", async (_req, res) => {
  const { data } = await plaid.linkTokenCreate({
    user: { client_user_id: "owner" },
    client_name: "Fin",
    country_codes: [CountryCode.Us],
    language: "en",
    redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
    products: [Products.Transactions],
    // Consent now, billed only once /investments/* is first called: sync calls holdings only for Items that
    // actually have investment accounts, so bank-only logins aren't billed for Investments.
    additional_consented_products: [Products.Investments],
    transactions: { days_requested: 730 },
  });
  res.json({ link_token: data.link_token });
});

link.post("/api/exchange", async (req, res) => {
  const { public_token, institution } = req.body as { public_token: string; institution?: string };
  const { data } = await plaid.itemPublicTokenExchange({ public_token });
  db.prepare("INSERT OR REPLACE INTO items (item_id, access_token, institution, created_at) VALUES (?, ?, ?, ?)")
    .run(data.item_id, data.access_token, institution ?? "Unknown", new Date().toISOString());
  await syncItem({ item_id: data.item_id, access_token: data.access_token, cursor: null });
  res.json({ ok: true });
});

// Streams progress as server-sent events (text/event-stream, which Caddy flushes immediately).
link.post("/api/sync", async (_req, res) => {
  if (isSyncRunning()) return void res.status(409).json({ error: "A sync is already running" });
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" }).flushHeaders();
  const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  try { await syncAll(send); } catch (e) { send({ event: "error", error: String(e) }); }
  res.end();
});
