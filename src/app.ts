import { join } from "node:path";
import express from "express";
import { accounts } from "./routes/accounts.js";
import { connections } from "./routes/connections.js";
import { link } from "./routes/link.js";
import { register } from "./routes/register.js";

const publicDir = join(import.meta.dirname, "..", "public");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.get("/healthz", (_req, res) => { res.send("ok"); });
  app.use(express.json());

  // Clean URLs: /accounts serves accounts.html, and the old .html addresses redirect to them.
  app.get(/^\/(.+)\.html$/, (req, res) => {
    const name = req.params[0] === "index" ? "" : req.params[0];
    res.redirect(301, "/" + name + req.url.slice(req.path.length));
  });
  app.use(express.static(publicDir, { extensions: ["html"] }));

  app.use(link, accounts, connections, register);
  return app;
}
