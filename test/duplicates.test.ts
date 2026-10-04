import assert from "node:assert/strict";
import { test } from "node:test";
import { findDuplicates, type DupAccount } from "../src/duplicates.js";

let n = 0;
const acct = (o: Partial<DupAccount> & Pick<DupAccount, "item_id" | "institution" | "mask">): DupAccount => ({
  account_id: `a${n++}`, name: "x", type: "depository", subtype: null, current_balance: 1, owner: "?", ...o,
});

test("same institution + type + mask across connections is a duplicate (high when balances match)", () => {
  const r = findDuplicates([
    acct({ item_id: "i1", institution: "Wells Fargo", mask: "1234", current_balance: 100, owner: "Alex" }),
    acct({ item_id: "i2", institution: "Wells Fargo", mask: "1234", current_balance: 100, owner: "Sam" }),
  ]);
  assert.equal(r.accounts.length, 1);
  assert.equal(r.accounts[0].confidence, "high");
  assert.equal(r.accounts[0].members.length, 2);
});

test("differing balances are 'likely'", () => {
  const r = findDuplicates([
    acct({ item_id: "i1", institution: "Wells Fargo", mask: "9999", current_balance: 5 }),
    acct({ item_id: "i2", institution: "Wells Fargo", mask: "9999", current_balance: 7 }),
  ]);
  assert.equal(r.accounts[0].confidence, "likely");
});

test("different bank, different type, same connection, or no mask are not duplicates", () => {
  const r = findDuplicates([
    acct({ item_id: "i1", institution: "Wells Fargo", mask: "1234" }),
    acct({ item_id: "i2", institution: "Chase", mask: "1234" }),                       // other bank
    acct({ item_id: "i1", institution: "Wells Fargo", mask: "4321", type: "credit" }),
    acct({ item_id: "i2", institution: "Wells Fargo", mask: "4321" }),                 // other type
    acct({ item_id: "i1", institution: "Ally", mask: "7777" }),
    acct({ item_id: "i1", institution: "Ally", mask: "7777", type: "depository" }),    // same connection
    acct({ item_id: "i3", institution: "Chase", mask: null as unknown as string }),
    acct({ item_id: "i4", institution: "Chase", mask: null as unknown as string }),    // no mask
  ]);
  assert.equal(r.accounts.length, 0);
});

test("a whole bank login linked twice is flagged as duplicate connections", () => {
  const r = findDuplicates([
    acct({ item_id: "a", institution: "Ameris", mask: "1" }), acct({ item_id: "a", institution: "Ameris", mask: "2" }),
    acct({ item_id: "b", institution: "Ameris", mask: "1" }), acct({ item_id: "b", institution: "Ameris", mask: "2" }),
  ]);
  assert.equal(r.connections.length, 1);
  assert.deepEqual(r.connections[0].item_ids.sort(), ["a", "b"]);
});
