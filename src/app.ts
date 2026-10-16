import { join } from "node:path";
import express from "express";
import { requireSession } from "./auth.js";
import { accounts } from "./routes/accounts.js";
import { auth } from "./routes/auth.js";
import { connections } from "./routes/connections.js";
import { link } from "./routes/link.js";
import { register } from "./routes/register.js";

const publicDir = join(import.meta.dirname, "..", "public");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback, linklocal, uniquelocal"); // Caddy: req.protocol/secure reflect the browser's https
  app.get("/healthz", (_req, res) => { res.send("ok"); });
  app.use(express.json());

  // Clean URLs: /accounts serves accounts.html, and the old .html addresses redirect to them.
  app.get(/^\/(.+)\.html$/, (req, res) => {
    const name = req.params[0] === "index" ? "" : req.params[0];
    res.redirect(301, "/" + name + req.url.slice(req.path.length));
  });
  app.use(requireSession);
  app.use(express.static(publicDir, { extensions: ["html"] }));

  app.use(auth, link, accounts, connections, register);
  return app;
}
