import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { useTempDb } from "./helpers.js";

useTempDb();
const { openDb } = await import("../src/db.js");

const KEY = "ab".repeat(32);
const tmp = () => join(mkdtempSync(join(tmpdir(), "fin-db-")), "t.db");
const plainHeader = (path: string) => readFileSync(path).subarray(0, 16).toString("latin1") === "SQLite format 3\0";

test("with a key the file is encrypted and needs that key to open", () => {
  const path = tmp();
  const db = openDb(path, KEY);
  db.exec("CREATE TABLE t (x); INSERT INTO t VALUES (42)");
  db.close();
  assert.equal(plainHeader(path), false);
  assert.throws(() => openDb(path), /not a database/);
  assert.throws(() => openDb(path, "cd".repeat(32)), /not a database/);
  assert.deepEqual(openDb(path, KEY).prepare("SELECT x FROM t").get(), { x: 42 });
});

test("an existing plaintext database is encrypted in place, keeping its data", () => {
  const path = tmp();
  const plain = openDb(path);
  plain.exec("CREATE TABLE t (x); INSERT INTO t VALUES ('kept')");
  plain.close();
  assert.equal(plainHeader(path), true);
  openDb(path, KEY).close();
  assert.equal(plainHeader(path), false);
  assert.deepEqual(openDb(path, KEY).prepare("SELECT x FROM t").get(), { x: "kept" });
});

test("a malformed key is rejected before touching the file", () => {
  assert.throws(() => openDb(tmp(), "not-hex"), /64 hex characters/);
});
