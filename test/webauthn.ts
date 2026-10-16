import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

// A software passkey (ES256, "none" attestation) that answers the server's WebAuthn options like a browser would.

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();
const b64 = (b: Buffer) => b.toString("base64url");

// Just enough CBOR for an attestation object and a COSE key: ints, byte/text strings, maps.
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => n < 24 ? Buffer.from([major << 5 | n])
    : n < 256 ? Buffer.from([major << 5 | 24, n]) : Buffer.from([major << 5 | 25, n >> 8, n & 255]);
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error("cbor: unsupported " + typeof v);
}

export class SoftPasskey {
  readonly id = randomBytes(16);
  private keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  private counter = 0;

  constructor(private origin: string) {}

  private authData(flags: number, attested?: Buffer) {
    const count = Buffer.alloc(4); count.writeUInt32BE(this.counter);
    return Buffer.concat([sha256(new URL(this.origin).hostname), Buffer.from([flags]), count, ...(attested ? [attested] : [])]);
  }
  private clientData(type: string, challenge: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  /** Answer registration options (navigator.credentials.create). */
  create(options: { challenge: string }) {
    const jwk = this.keys.publicKey.export({ format: "jwk" });
    const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]));
    const idLen = Buffer.alloc(2); idLen.writeUInt16BE(this.id.length);
    const authData = this.authData(0x45, Buffer.concat([Buffer.alloc(16), idLen, this.id, cose])); // UP | UV | AT
    return {
      id: b64(this.id), rawId: b64(this.id), type: "public-key", clientExtensionResults: {},
      response: {
        clientDataJSON: b64(this.clientData("webauthn.create", options.challenge)),
        attestationObject: b64(cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))),
        transports: ["internal"],
      },
    };
  }

  /** Answer sign-in options (navigator.credentials.get). */
  get(options: { challenge: string }) {
    this.counter++;
    const authData = this.authData(0x05); // UP | UV
    const clientData = this.clientData("webauthn.get", options.challenge);
    return {
      id: b64(this.id), rawId: b64(this.id), type: "public-key", clientExtensionResults: {},
      response: {
        clientDataJSON: b64(clientData), authenticatorData: b64(authData),
        signature: b64(sign("sha256", Buffer.concat([authData, sha256(clientData)]), this.keys.privateKey)),
      },
    };
  }
}
