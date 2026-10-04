import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Point the app at a throwaway database. Must run before anything imports src/db.ts. */
export function useTempDb() {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "fin-test-"));
}
