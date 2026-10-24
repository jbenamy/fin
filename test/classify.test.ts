import assert from "node:assert/strict";
import { test } from "node:test";
import { accountGroup, accountKind, groupRank, GROUP_ORDER, signedBalance } from "../src/classify.js";

test("accountGroup maps Plaid type/subtype to display groups", () => {
  assert.equal(accountGroup("depository", "checking"), "Checking");
  assert.equal(accountGroup("depository", "money market"), "Savings");
  assert.equal(accountGroup("depository", "hsa"), "HSA");
  assert.equal(accountGroup("credit", "credit card"), "Credit Cards");
  assert.equal(accountGroup("loan", "mortgage"), "Loans");
  assert.equal(accountGroup("investment", "brokerage"), "Brokerage");
  assert.equal(accountGroup("investment", "529"), "Education");
  assert.equal(accountGroup("other", null), "Other");
});

test("employer plans are 401(k); IRAs and pensions stay Retirement", () => {
  for (const st of ["401k", "403b", "roth 401k", "457b", "401a"]) assert.equal(accountGroup("investment", st), "401(k)", st);
  for (const st of ["ira", "roth", "pension", "sep ira"]) assert.equal(accountGroup("investment", st), "Retirement", st);
});

test("signedBalance makes credit and loan balances negative", () => {
  assert.equal(signedBalance("credit", 100), -100);
  assert.equal(signedBalance("loan", 5), -5);
  assert.equal(signedBalance("depository", 100), 100);
  assert.equal(signedBalance("investment", 7), 7);
  assert.equal(signedBalance("credit", null), null);
  assert.ok(Object.is(signedBalance("credit", 0), 0));   // a paid-off card is 0, never -0 ("-$0.00")
});

test("accountKind buckets for the dashboard tiles", () => {
  assert.equal(accountKind("depository"), "cash");
  assert.equal(accountKind("investment"), "investment");
  assert.equal(accountKind("credit"), "debt");
  assert.equal(accountKind("loan"), "debt");
  assert.equal(accountKind("other"), "other");
});

test("groupRank follows GROUP_ORDER; unknown groups sort last", () => {
  assert.equal(groupRank("Checking"), 0);
  assert.ok(groupRank("Brokerage") < groupRank("401(k)"));
  assert.equal(groupRank("Not a group"), GROUP_ORDER.length);
});
