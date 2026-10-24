/** JSON request helper: `json` is sent as the body; a non-2xx response throws with the server's message. */
export async function api<T = any>(path: string, { method = "GET", json }: { method?: string; json?: unknown } = {}): Promise<T> {
  const init: RequestInit = { method };
  if (json !== undefined) { init.headers = { "content-type": "application/json" }; init.body = JSON.stringify(json); }
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  // Session gone (expired, signed out elsewhere, passkey removed): back to the login page, then here again.
  if (res.status === 401 && !path.startsWith("/api/auth/")) location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search + location.hash);
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

/** End this browser's session and go to the login page. */
export async function signOut() { await api("/api/auth/logout", { method: "POST" }); location.href = "/login"; }

/** The message of a caught value. */
export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
