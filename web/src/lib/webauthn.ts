// Passkey ceremonies: the server's JSON options -> navigator.credentials -> JSON back to the server.
import { api } from "./api";

const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const toB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ids = (list?: { id: string }[]) => (list ?? []).map((c) => ({ ...c, id: fromB64(c.id) }));

/** Turn the browser's "user cancelled / timed out" into a short message; anything else keeps its text. */
const friendly = (e: any) => e?.name === "NotAllowedError" ? new Error("Cancelled or timed out") :
  e?.name === "InvalidStateError" ? new Error("This device already has a Fin passkey") : e;

/** The JSON shape @simplewebauthn/server expects, around the ceremony-specific `response` fields. */
const credentialJSON = (cred: PublicKeyCredential, response: Record<string, unknown>) => ({ response: {
  id: cred.id, rawId: toB64(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(),
  authenticatorAttachment: cred.authenticatorAttachment ?? undefined, response,
} });

export const supported = () => !!window.PublicKeyCredential;

/** Sign in with any registered passkey (discoverable, so no username). */
export async function signInWithPasskey() {
  const o = await api("/api/auth/login/options", { method: "POST" });
  let cred: PublicKeyCredential;
  try { cred = await navigator.credentials.get({ publicKey: { ...o, challenge: fromB64(o.challenge), allowCredentials: ids(o.allowCredentials) } }) as PublicKeyCredential; }
  catch (e) { throw friendly(e); }
  const r = cred.response as AuthenticatorAssertionResponse;
  return api("/api/auth/login/verify", { method: "POST", json: credentialJSON(cred, {
    clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature),
    userHandle: r.userHandle ? toB64(r.userHandle) : undefined,
  }) });
}

/** Create a passkey named `label` on this device. `invite` is the token from an invite link, if any. */
export async function registerPasskey(label: string, invite?: string | null) {
  const o = await api("/api/auth/register/options", { method: "POST", json: { label, invite } });
  let cred: PublicKeyCredential;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      ...o, challenge: fromB64(o.challenge), user: { ...o.user, id: fromB64(o.user.id) }, excludeCredentials: ids(o.excludeCredentials),
    } }) as PublicKeyCredential;
  } catch (e) { throw friendly(e); }
  const r = cred.response as AuthenticatorAttestationResponse;
  return api("/api/auth/register/verify", { method: "POST", json: credentialJSON(cred, {
    clientDataJSON: toB64(r.clientDataJSON), attestationObject: toB64(r.attestationObject), transports: r.getTransports?.() ?? [],
  }) });
}
