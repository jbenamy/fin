// The package ships index.d.ts, but its package.json "exports" has no "types" condition, so NodeNext resolution
// can't find it. Re-export it under the package name (types only; tsx resolves the runtime import normally).
declare module "better-sqlite3-multiple-ciphers" {
  import Database from "../node_modules/better-sqlite3-multiple-ciphers/index.js";
  export default Database;
}
