import { join } from "node:path";
import express from "express";
import { requireSession } from "./auth.js";
import { jsonErrors } from "./http.js";
import { accounts } from "./routes/accounts.js";
import { auth } from "./routes/auth.js";
import { connections } from "./routes/connections.js";
import { holdings } from "./routes/holdings.js";
import { link } from "./routes/link.js";
import { register } from "./routes/register.js";

// The Svelte app (web/, built by Vite into dist/web). Each page address serves its index.html; routing is client-side.
const webDir = process.env.WEB_DIR ?? join(import.meta.dirname, "..", "dist", "web"); // tests point WEB_DIR at a stub
const PAGES = ["/", "/accounts", "/connections", "/passkeys", "/login"];

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback, linklocal, uniquelocal"); // Caddy: req.protocol/secure reflect the browser's https
  app.get("/healthz", (_req, res) => { res.send("ok"); });
  app.use(express.json());

  // Old .html addresses (bookmarks from before the clean URLs) redirect to the clean form.
  app.get(/^\/(.+)\.html$/, (req, res) => {
    const name = req.params[0] === "index" ? "" : req.params[0];
    res.redirect(301, "/" + name + req.url.slice(req.path.length));
  });
  app.use(requireSession);
  app.get(PAGES, (_req, res) => { res.set("Cache-Control", "no-cache").sendFile(join(webDir, "index.html")); });
  // Vite fingerprints asset names, so they can be cached for good.
  app.use("/assets", express.static(join(webDir, "assets"), { immutable: true, maxAge: "1y" }));
  app.use(express.static(webDir, { index: false }));

  app.use(auth, link, accounts, connections, register, holdings);
  app.use(jsonErrors);
  return app;
}
