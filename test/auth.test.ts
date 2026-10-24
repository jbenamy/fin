import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { useTempDb } from "./helpers.js";
import { SoftPasskey } from "./webauthn.js";

useTempDb();
const { db } = await import("../src/db.js");
const { createApp } = await import("../src/app.js");

let server: Server, base: string;
let alexKey: SoftPasskey; // registered by the first-passkey test, reused by later ones
before(() => {
  server = createApp().listen(0);
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(() => { server.close(); });

/** One browser: keeps its session cookie between requests. */
class Browser {
  cookie = "";
  async fetch(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers: Record<string, string> = { cookie: this.cookie };
    if (init.json !== undefined) { headers["content-type"] = "application/json"; init = { method: "POST", ...init, body: JSON.stringify(init.json) }; }
    const res = await fetch(base + path, { redirect: "manual", ...init, headers });
    const set = res.headers.get("set-cookie")?.match(/fin_session=([^;]*)/);
    if (set) this.cookie = set[1] ? "fin_session=" + set[1] : "";
    return res;
  }
  async post(path: string, json: unknown = {}) {
    const res = await this.fetch(path, { json });
    return { status: res.status, body: await res.json() as any };
  }
  async register(key: SoftPasskey, label: string, invite?: string) {
    const options = await this.post("/api/auth/register/options", { label, invite });
    if (options.status !== 200) return options;
    return this.post("/api/auth/register/verify", { response: key.create(options.body) });
  }
  async signIn(key: SoftPasskey) {
    const options = await this.post("/api/auth/login/options");
    const response = key.get(options.body);
    return { response, result: await this.post("/api/auth/login/verify", { response }) };
  }
  signedIn = async () => (await this.fetch("/api/accounts")).status === 200;
}

test("without a session: pages redirect to /login (keeping the address), the API is 401, login assets are public", async () => {
  const b = new Browser();
  assert.equal((await b.fetch("/api/accounts")).status, 401);
  assert.equal((await b.fetch("/api/passkeys/invite", { method: "POST" })).status, 401);
  const home = await b.fetch("/");
  assert.equal(home.status, 302);
  assert.equal(home.headers.get("location"), "/login");
  // Plaid's OAuth return lands on /accounts?oauth_state_id=...; it must survive the trip through /login.
  assert.equal((await b.fetch("/accounts?oauth_state_id=abc")).headers.get("location"), "/login?next=%2Faccounts%3Foauth_state_id%3Dabc");
  // The login page is the app itself, so its bundle is public; account data only comes from the API.
  for (const path of ["/login", "/assets/app.js", "/favicon.svg", "/healthz"]) {
    assert.equal((await b.fetch(path)).status, 200, path);
  }
  for (const path of ["/accounts", "/connections", "/passkeys"]) assert.equal((await b.fetch(path)).status, 302, path);
});

test("first passkey: open setup while none exist, then closed; sign in, replay, logout", async () => {
  const alex = new Browser(), key = alexKey = new SoftPasskey(base);
  assert.equal(((await (await alex.fetch("/api/auth/status")).json()) as any).setup, true);

  const reg = await alex.register(key, "Alex's phone");
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  assert.ok(await alex.signedIn());                       // setup signs the new passkey in
  assert.equal(((await (await alex.fetch("/api/auth/status")).json()) as any).setup, false);

  // Setup is now closed to everyone else.
  const stranger = new Browser();
  assert.equal((await stranger.register(new SoftPasskey(base), "Mallory")).status, 403);

  // Sign in on a fresh browser with the same passkey.
  const laptop = new Browser();
  const { response, result } = await laptop.signIn(key);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(await laptop.signedIn());
  const row = db.prepare("SELECT counter, last_used FROM passkeys").get() as { counter: number; last_used: string };
  assert.equal(row.counter, 1);
  assert.ok(row.last_used);
  // The challenge is single-use: replaying the same signed response fails.
  assert.equal((await new Browser().post("/api/auth/login/verify", { response })).status, 400);
  // An unknown passkey is refused.
  const other = await new Browser().signIn(new SoftPasskey(base));
  assert.equal(other.result.status, 401);

  await laptop.post("/api/auth/logout");
  assert.ok(!(await laptop.signedIn()));
  assert.ok(await alex.signedIn());                       // other sessions are untouched
});

test("invite links add a passkey once; removing a passkey ends its sessions; the last one can't be removed", async () => {
  const alex = new Browser();
  assert.equal((await alex.signIn(alexKey)).result.status, 200);

  const { body: { url } } = await alex.post("/api/passkeys/invite");
  const invite = new URL(url).searchParams.get("invite")!;
  assert.equal(new URL(url).origin, base);

  const sam = new Browser(), samKey = new SoftPasskey(base);
  assert.equal(((await (await sam.fetch("/api/auth/status?invite=" + invite)).json()) as any).invite, true);
  assert.equal((await sam.register(samKey, "Sam's laptop", invite)).status, 200);
  assert.ok(await sam.signedIn());
  assert.equal((await new Browser().register(new SoftPasskey(base), "Again", invite)).status, 403); // one use

  const list = (await (await sam.fetch("/api/passkeys")).json()) as any[];
  assert.deepEqual(list.map((p) => p.label).sort(), ["Alex's phone", "Sam's laptop"]);
  assert.equal(list.find((p) => p.current).label, "Sam's laptop");

  // Alex removes Sam's passkey: Sam is signed out and can't sign back in with it.
  const samId = list.find((p) => p.current).id;
  assert.equal((await alex.fetch("/api/passkeys/" + encodeURIComponent(samId), { method: "DELETE" })).status, 200);
  assert.ok(!(await sam.signedIn()));
  assert.equal((await sam.signIn(samKey)).result.status, 401);

  const [last] = (await (await alex.fetch("/api/passkeys")).json()) as any[];
  assert.equal((await alex.fetch("/api/passkeys/" + encodeURIComponent(last.id), { method: "DELETE" })).status, 409);
});
