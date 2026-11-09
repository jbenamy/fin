import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Point the app at a throwaway database and a stub web build. Must run before anything imports src/db.ts. */
export function useTempDb() {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "fin-test-"));
  // dist/web's stand-in, one level down so build-info.json (if a test writes one) sits beside it as in dist/.
  const web = process.env.WEB_DIR = join(mkdtempSync(join(tmpdir(), "fin-dist-")), "web");
  mkdirSync(join(web, "assets"), { recursive: true });
  writeFileSync(join(web, "index.html"), "<!doctype html><title>Fin</title><script type=module src=/assets/app.js></script>");
  writeFileSync(join(web, "assets", "app.js"), "export {};");
  writeFileSync(join(web, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
}
