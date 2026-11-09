import { Router } from "express";
import { Plaid } from "plaid";
import { db } from "../db.js";
import { plaid } from "../plaid.js";
import { isSyncRunning, syncAll, syncItem } from "../sync.js";

export const link = Router();

link.post("/api/link-token", async (_req, res) => {
  const { link_token } = await plaid.link.createToken({
    user: { client_user_id: "owner" },
    client_name: "Fin",
    country_codes: [Plaid.CountryCode.Us],
    language: "en",
    redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
    products: [Plaid.Products.Transactions],
    // Consent now, billed only once /investments/* is first called: sync calls holdings only for Items that
    // actually have investment accounts, so bank-only logins aren't billed for Investments.
    additional_consented_products: [Plaid.Products.Investments],
    transactions: { days_requested: 730 },
  });
  res.json({ link_token });
});

link.post("/api/exchange", async (req, res) => {
  const { public_token, institution } = req.body as { public_token: string; institution?: string };
  const { item_id, access_token } = await plaid.item.exchangePublicToken({ public_token });
  db.prepare("INSERT OR REPLACE INTO items (item_id, access_token, institution, created_at) VALUES (?, ?, ?, ?)")
    .run(item_id, access_token, institution ?? "Unknown", new Date().toISOString());
  await syncItem({ item_id, access_token, cursor: null });
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
