import { createHash, randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { db } from "./db.js";

// Cookie sessions for passkey login. The cookie holds a random token; the DB keeps only its sha256.
const COOKIE = "fin_session";
const SESSION_DAYS = 30;
const DAY = 86400e3;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Store a new session for `passkeyId` and return its raw token (exported for tests). */
export function createSession(passkeyId: string) {
  const token = newToken(), now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date(now).toISOString());
  db.prepare("INSERT INTO sessions (token_hash, passkey_id, created_at, expires_at) VALUES (?,?,?,?)")
    .run(hashToken(token), passkeyId, new Date(now).toISOString(), new Date(now + SESSION_DAYS * DAY).toISOString());
  return token;
}

const setCookie = (req: Request, res: Response, token: string, maxAge: number) =>
  res.append("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.secure ? "; Secure" : ""}`);

export function signIn(req: Request, res: Response, passkeyId: string) {
  setCookie(req, res, createSession(passkeyId), SESSION_DAYS * 86400);
}

export function signOut(req: Request, res: Response) {
  const token = cookies(req)[COOKIE];
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  setCookie(req, res, "", 0);
}

/** The passkey id behind this request's session, or null. Sessions slide: use renews them once a day. */
export function sessionPasskey(req: Request, res?: Response): string | null {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  const row = db.prepare("SELECT passkey_id, expires_at FROM sessions WHERE token_hash = ?").get(hashToken(token)) as
    { passkey_id: string; expires_at: string } | undefined;
  if (!row || row.expires_at < new Date().toISOString()) return null;
  const left = new Date(row.expires_at).getTime() - Date.now();
  if (res && left < (SESSION_DAYS - 1) * DAY) {
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(new Date(Date.now() + SESSION_DAYS * DAY).toISOString(), hashToken(token));
    setCookie(req, res, token, SESSION_DAYS * 86400);
  }
  return row.passkey_id;
}

// Reachable without a session: the login page and what it loads, plus the auth API itself.
const PUBLIC = new Set(["/login", "/shared.css", "/shared.js", "/js/login.js", "/js/webauthn.js", "/favicon.svg", "/favicon.ico", "/apple-touch-icon.png"]);

/** Everything else needs a session: pages redirect to /login (keeping the address), the API answers 401. */
export const requireSession: RequestHandler = (req, res, next) => {
  if (PUBLIC.has(req.path) || req.path.startsWith("/api/auth/")) return next();
  if (sessionPasskey(req, res)) return next();
  if (req.path.startsWith("/api/") || req.method !== "GET") { res.status(401).json({ error: "Sign in required" }); return; }
  res.redirect(302, "/login" + (req.originalUrl === "/" ? "" : "?next=" + encodeURIComponent(req.originalUrl)));
};
