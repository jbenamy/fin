import { createHash, randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { db } from "./db.js";

// Cookie sessions for passkey login. The cookie holds a random token; the DB keeps only its sha256.
const COOKIE = "fin_session";
const DAY = 86400e3;
const SESSION_MS = 30 * DAY;
const iso = (ms: number) => new Date(ms).toISOString();

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
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(iso(now));
  db.prepare("INSERT INTO sessions (token_hash, passkey_id, created_at, expires_at) VALUES (?,?,?,?)")
    .run(hashToken(token), passkeyId, iso(now), iso(now + SESSION_MS));
  return token;
}

const setCookie = (req: Request, res: Response, token: string, maxAgeMs = SESSION_MS) =>
  res.append("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeMs / 1000}${req.secure ? "; Secure" : ""}`);

export function signIn(req: Request, res: Response, passkeyId: string) {
  setCookie(req, res, createSession(passkeyId));
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
  const hash = hashToken(token);
  const row = db.prepare("SELECT passkey_id, expires_at FROM sessions WHERE token_hash = ?").get(hash) as
    { passkey_id: string; expires_at: string } | undefined;
  const now = Date.now();
  if (!row || row.expires_at < iso(now)) return null;
  if (res && new Date(row.expires_at).getTime() - now < SESSION_MS - DAY) {
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(iso(now + SESSION_MS), hash);
    setCookie(req, res, token);
  }
  return row.passkey_id;
}

// Reachable without a session: the login page, the app's static files (one bundle for every page; no data in it),
// and the auth API itself. Account data only ever comes from /api, which stays behind the session.
const PUBLIC = new Set(["/login", "/favicon.svg", "/favicon.ico", "/apple-touch-icon.png"]);

/** Everything else needs a session: pages redirect to /login (keeping the address), the API answers 401. */
export const requireSession: RequestHandler = (req, res, next) => {
  if (PUBLIC.has(req.path) || req.path.startsWith("/assets/") || req.path.startsWith("/api/auth/")) return next();
  if (sessionPasskey(req, res)) return next();
  if (req.path.startsWith("/api/") || req.method !== "GET") { res.status(401).json({ error: "Sign in required" }); return; }
  res.redirect(302, "/login" + (req.originalUrl === "/" ? "" : "?next=" + encodeURIComponent(req.originalUrl)));
};
