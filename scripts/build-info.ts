// Writes dist/build-info.json at build time for the About page: Fin's version and commit, the build time, pnpm, and
// the installed version of every direct dependency of both packages. Dev dependencies (TypeScript, Vite, Svelte…)
// are pruned from the production image, so their versions have to be captured here rather than read at runtime.
// The commit comes from FIN_COMMIT (the Docker build has no .git) or else from git.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Manifest { version?: string; packageManager?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
interface BuildPackage { name: string; version: string | null; wanted: string; part: "server" | "web"; dev: boolean }

const root = join(import.meta.dirname, "..");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

function packages(dir: string, part: BuildPackage["part"]): BuildPackage[] {
  const m = readJson<Manifest>(join(dir, "package.json"));
  const list = (deps: Record<string, string> = {}, dev: boolean) => Object.entries(deps).map(([name, wanted]) => {
    let version: string | null = null;
    try { version = readJson<Manifest>(join(dir, "node_modules", name, "package.json")).version ?? null; } catch { /* not installed */ }
    return { name, version, wanted, part, dev };
  });
  return [...list(m.dependencies, false), ...list(m.devDependencies, true)];
}

function commit(): string | null {
  if (process.env.FIN_COMMIT) return process.env.FIN_COMMIT;
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return git("rev-parse", "--short=10", "HEAD") + (git("status", "--porcelain") ? "-dirty" : "");
  } catch { return null; }
}

const app = readJson<Manifest>(join(root, "package.json"));
const info = {
  version: app.version ?? null,
  commit: commit(),
  built_at: new Date().toISOString(),
  pnpm: app.packageManager?.replace(/^pnpm@/, "") ?? null,
  packages: [...packages(root, "server"), ...packages(join(root, "web"), "web")],
};
writeFileSync(join(root, "dist", "build-info.json"), JSON.stringify(info, null, 2) + "\n");
