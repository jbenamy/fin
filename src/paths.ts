import { join } from "node:path";

/** The Svelte app (web/, built by Vite into dist/web); tests point WEB_DIR at a stub. src/ and dist/ are siblings, so this works from either. */
export const webDir = process.env.WEB_DIR ?? join(import.meta.dirname, "..", "dist", "web");
/** Written next to the web build by scripts/build-info.ts: Fin's version, commit and package versions. */
export const buildInfoFile = join(webDir, "..", "build-info.json");
