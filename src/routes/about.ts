import { readFileSync } from "node:fs";
import { arch, release, type } from "node:os";
import { Router } from "express";
import { db } from "../db.js";
import { buildInfoFile } from "../paths.js";
import { PLAID_API_VERSION, plaidEnv } from "../plaid.js";

export const about = Router();

interface BuildInfo {
  version: string | null; commit: string | null; built_at: string; pnpm: string | null;
  packages: { name: string; version: string | null; wanted: string; part: "server" | "web"; dev: boolean }[];
}

const startedAt = new Date().toISOString();

/** The build's info, or null when there is none (tests, a dev server before its first `pnpm build`). Re-read per request: `pnpm build` rewrites it under a running dev server. */
function buildInfo(): BuildInfo | null {
  try { return JSON.parse(readFileSync(buildInfoFile, "utf8")) as BuildInfo; } catch { return null; }
}

/** The container's distribution (e.g. "Debian GNU/Linux 13 (trixie)"), if it says. */
function distro(): string | null {
  try { return /^PRETTY_NAME="?([^"\n]*)"?$/m.exec(readFileSync("/etc/os-release", "utf8"))?.[1] ?? null; } catch { return null; }
}

// Versions of Fin and everything it runs on. Rows are label/value pairs so the page just lists them.
about.get("/api/about", (_req, res) => {
  const build = buildInfo();
  const sqlite = db.prepare("SELECT sqlite_version() AS sqlite, sqlite3mc_version() AS mc").get() as { sqlite: string; mc: string };
  const plaidSdk = build?.packages.find((p) => p.name === "plaid" && p.part === "server")?.version ?? null;
  const row = (label: string, value: string | null) => ({ label, value });
  res.json({
    version: build?.version ?? null,
    commit: build?.commit ?? null,
    built_at: build?.built_at ?? null,
    started_at: startedAt,
    runtime: [
      row("Node.js", process.versions.node),
      row("V8", process.versions.v8),
      row("OpenSSL", process.versions.openssl ?? null),
      row("SQLite", sqlite.sqlite),
      row("SQLite3 Multiple Ciphers", sqlite.mc.replace(/^SQLite3 Multiple Ciphers\s*/, "")),
      row("pnpm (build)", build?.pnpm ?? null),
      row("Operating system", distro() ?? type()),
      row("Kernel", `${release()} (${arch()})`),
      row("Time zone", Intl.DateTimeFormat().resolvedOptions().timeZone),
    ],
    plaid: [
      row("API version", PLAID_API_VERSION),
      row("SDK (plaid)", plaidSdk),
      row("Environment", plaidEnv),
    ],
    packages: build?.packages ?? [],
  });
});
