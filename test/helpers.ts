import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Point the app at a throwaway database and a stub web build. Must run before anything imports src/db.ts. */
export function useTempDb() {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "fin-test-"));
  const web = process.env.WEB_DIR = mkdtempSync(join(tmpdir(), "fin-web-"));
  mkdirSync(join(web, "assets"));
  writeFileSync(join(web, "index.html"), "<!doctype html><title>Fin</title><script type=module src=/assets/app.js></script>");
  writeFileSync(join(web, "assets", "app.js"), "export {};");
  writeFileSync(join(web, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
}
