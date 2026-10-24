import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { randomBytes } from "node:crypto";
import { Router, type Request } from "express";
import { hashToken, newToken, sessionPasskey, signIn, signOut } from "../auth.js";
import { db } from "../db.js";
import { cleanLabel } from "../http.js";

export const auth = Router();

const INVITE_HOURS = 24;
const CHALLENGE_MS = 5 * 60e3;

interface PasskeyRow { id: string; public_key: Uint8Array; counter: number; transports: string | null; label: string; created_at: string; last_used: string | null }

/** The WebAuthn origin and RP id: APP_ORIGIN if set, else the address this request came in on (via Caddy). */
function relyingParty(req: Request) {
  const origin = process.env.APP_ORIGIN?.replace(/\/$/, "") || `${req.protocol}://${req.get("host")}`;
  return { origin, rpID: new URL(origin).hostname };
}

// Challenges we issued and haven't seen back yet, with what each one is allowed to do. Single instance, so memory is fine.
type Pending = { kind: "login" } | { kind: "register"; label: string; via: "session" | "setup" | "invite"; invite?: string };
const pending = new Map<string, Pending & { expires: number }>();
function remember(challenge: string, p: Pending) {
  const now = Date.now();
  for (const [c, v] of pending) if (v.expires < now) pending.delete(c);
  pending.set(challenge, { ...p, expires: now + CHALLENGE_MS });
}
/** Take (one use only) the pending challenge a browser response answers. */
function take(response: { response?: { clientDataJSON?: string } }) {
  let challenge: string;
  try { challenge = JSON.parse(Buffer.from(String(response?.response?.clientDataJSON), "base64url").toString()).challenge; }
  catch { return null; }
  const p = pending.get(challenge);
  pending.delete(challenge);
  return p && p.expires > Date.now() ? { challenge, ...p } : null;
}

const passkeyCount = () => (db.prepare("SELECT COUNT(*) AS n FROM passkeys").get() as { n: number }).n;
const validInvite = (token: unknown) => typeof token === "string" && !!db.prepare("SELECT 1 FROM invites WHERE token_hash = ? AND expires_at > ?")
  .get(hashToken(token), new Date().toISOString());
const transports = (row: PasskeyRow) => (row.transports ? JSON.parse(row.transports) : undefined) as AuthenticatorTransportFuture[] | undefined;

// ---- public: status, sign in, sign out ----------------------------------------------------------------------------
// `setup` = no passkey exists yet, so the first visitor may create one (the network is the only gate until then).
auth.get("/api/auth/status", (req, res) => {
  res.json({ signedIn: !!sessionPasskey(req), setup: passkeyCount() === 0, invite: req.query.invite ? validInvite(req.query.invite) : undefined });
});

auth.post("/api/auth/login/options", async (req, res) => {
  const options = await generateAuthenticationOptions({ rpID: relyingParty(req).rpID, userVerification: "required" });
  remember(options.challenge, { kind: "login" });
  res.json(options);
});

auth.post("/api/auth/login/verify", async (req, res) => {
  const response = req.body?.response as AuthenticationResponseJSON;
  const p = take(response);
  if (p?.kind !== "login") { res.status(400).json({ error: "Sign-in expired, try again" }); return; }
  const row = db.prepare("SELECT * FROM passkeys WHERE id = ?").get(String(response.id)) as PasskeyRow | undefined;
  if (!row) { res.status(401).json({ error: "This passkey isn't registered with Fin" }); return; }
  const { origin, rpID } = relyingParty(req);
  const result = await verifyAuthenticationResponse({
    response, expectedChallenge: p.challenge, expectedOrigin: origin, expectedRPID: rpID,
    credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: transports(row) },
  }).catch(() => null);
  if (!result?.verified) { res.status(401).json({ error: "Passkey check failed" }); return; }
  db.prepare("UPDATE passkeys SET counter = ?, last_used = ? WHERE id = ?").run(result.authenticationInfo.newCounter, new Date().toISOString(), row.id);
  signIn(req, res, row.id);
  res.json({ ok: true });
});

auth.post("/api/auth/logout", (req, res) => { signOut(req, res); res.json({ ok: true }); });

// ---- registering a passkey: signed in, first-time setup, or via an invite link -------------------------------------
auth.post("/api/auth/register/options", async (req, res) => {
  const via = sessionPasskey(req) ? "session" : passkeyCount() === 0 ? "setup" : validInvite(req.body?.invite) ? "invite" : null;
  if (!via) { res.status(403).json({ error: "Sign in first, or use an invite link from someone who is signed in" }); return; }
  const label = cleanLabel(req.body?.label, 60) ?? "Passkey";
  const existing = db.prepare("SELECT id, transports FROM passkeys").all() as unknown as PasskeyRow[];
  const options = await generateRegistrationOptions({
    rpName: "Fin", rpID: relyingParty(req).rpID, userName: label, userDisplayName: label, userID: randomBytes(16),
    attestationType: "none", excludeCredentials: existing.map((r) => ({ id: r.id, transports: transports(r) })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  remember(options.challenge, { kind: "register", label, via, invite: via === "invite" ? hashToken(req.body.invite) : undefined });
  res.json(options);
});

auth.post("/api/auth/register/verify", async (req, res) => {
  const response = req.body?.response as RegistrationResponseJSON;
  const p = take(response);
  if (p?.kind !== "register") { res.status(400).json({ error: "Registration expired, try again" }); return; }
  // The permission is re-checked: the session may have ended, setup may have been claimed, or the invite used.
  const still = p.via === "session" ? !!sessionPasskey(req) : p.via === "setup" ? passkeyCount() === 0 :
    db.prepare("DELETE FROM invites WHERE token_hash = ? AND expires_at > ?").run(p.invite!, new Date().toISOString()).changes > 0;
  if (!still) { res.status(403).json({ error: p.via === "invite" ? "This invite link was already used or has expired" : "Not allowed any more, sign in again" }); return; }
  const { origin, rpID } = relyingParty(req);
  const result = await verifyRegistrationResponse({ response, expectedChallenge: p.challenge, expectedOrigin: origin, expectedRPID: rpID }).catch(() => null);
  if (!result?.verified) { res.status(400).json({ error: "Passkey registration failed" }); return; }
  const c = result.registrationInfo.credential;
  db.prepare("INSERT INTO passkeys (id, public_key, counter, transports, label, created_at) VALUES (?,?,?,?,?,?)")
    .run(c.id, c.publicKey, c.counter, c.transports ? JSON.stringify(c.transports) : null, p.label, new Date().toISOString());
  if (p.via !== "session") signIn(req, res, c.id);
  res.json({ ok: true });
});

// ---- managing passkeys (behind the session guard) -----------------------------------------------------------------
auth.get("/api/passkeys", (req, res) => {
  const current = sessionPasskey(req);
  const rows = db.prepare("SELECT id, label, created_at, last_used FROM passkeys ORDER BY created_at").all() as unknown as PasskeyRow[];
  res.json(rows.map((r) => ({ id: r.id, label: r.label, created_at: r.created_at, last_used: r.last_used, current: r.id === current })));
});

// Removing the last passkey would reopen first-time setup to anyone on the network, so it's refused.
auth.delete("/api/passkeys/:id", (req, res) => {
  if (passkeyCount() <= 1) { res.status(409).json({ error: "Can't remove the only passkey" }); return; }
  if (!db.prepare("DELETE FROM passkeys WHERE id = ?").run(req.params.id).changes) { res.status(404).json({ error: "No such passkey" }); return; }
  db.prepare("DELETE FROM sessions WHERE passkey_id = ?").run(req.params.id);
  res.json({ ok: true });
});

auth.post("/api/passkeys/invite", (req, res) => {
  const token = newToken(), now = new Date(), expires = new Date(now.getTime() + INVITE_HOURS * 3600e3).toISOString();
  db.prepare("DELETE FROM invites WHERE expires_at < ?").run(now.toISOString());
  db.prepare("INSERT INTO invites (token_hash, created_at, expires_at) VALUES (?,?,?)").run(hashToken(token), now.toISOString(), expires);
  res.json({ url: `${relyingParty(req).origin}/login?invite=${token}`, expires_at: expires });
});
