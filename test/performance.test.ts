import assert from "node:assert/strict";
import { test } from "node:test";
import { type Activity, externalFlow, periods, series } from "../src/performance.js";

const act = (date: string, type: string, subtype: string, amount: number, quantity: number | null = null, price: number | null = null): Activity =>
  ({ date, type, subtype, amount, quantity, price });

test("external flows: cash in/out, in-kind transfers, retirement contributions; trades and income are internal", () => {
  assert.equal(externalFlow(act("2026-01-01", "cash", "deposit", -100)), 100);
  assert.equal(externalFlow(act("2026-01-01", "cash", "withdrawal", 40)), -40);
  assert.equal(externalFlow(act("2026-01-01", "cash", "contribution", -500)), 500);
  assert.equal(externalFlow(act("2026-01-01", "transfer", "transfer", 0, 10, 20)), 200);       // shares moved in
  assert.equal(externalFlow(act("2026-01-01", "buy", "contribution", 250, 2, 125)), 250);      // 401(k) payroll buy
  assert.equal(externalFlow(act("2026-01-01", "sell", "distribution", -300, -3, 100)), -300);  // IRA payout
  for (const t of [act("2026-01-01", "buy", "buy", 100, 1, 100), act("2026-01-01", "sell", "sell", -100, -1, 100),
    act("2026-01-01", "cash", "dividend", -5), act("2026-01-01", "fee", "account fee", 2), act("2026-01-01", "cancel", "deposit", 100)]) {
    assert.equal(externalFlow(t), null, `${t.type}/${t.subtype}`);
  }
});

test("periods: gain excludes contributions, Modified Dietz return, only fully covered periods", () => {
  const snaps = [{ date: "2026-10-01", value: 1000 }, { date: "2026-10-11", value: 1600 }, { date: "2026-10-21", value: 1700 }];
  const activity = [
    act("2026-09-15", "cash", "deposit", -999),      // before the first snapshot: already in its value
    act("2026-10-11", "cash", "deposit", -500),      // halfway through
    act("2026-10-12", "cash", "dividend", -10),
    act("2026-10-13", "fee", "account fee", 3),
    act("2026-10-14", "buy", "buy", 400, 4, 100),
  ];
  const ps = periods(snaps, activity, new Date("2026-10-21T12:00:00Z"));
  assert.deepEqual(ps.map((p) => p.key), ["all"]);   // 1M would need a snapshot on or before Sep 21
  const all = ps[0]!;
  assert.deepEqual([all.start, all.end, all.net_contributions, all.gain, all.income, all.fees], ["2026-10-01", "2026-10-21", 500, 200, 10, -3]);
  assert.equal(all.return, 200 / (1000 + 500 * 0.5));

  // With older snapshots, 1M starts at the last one on or before its start date.
  const longer = [{ date: "2026-09-10", value: 900 }, { date: "2026-09-20", value: 950 }, ...snaps];
  const oneMonth = periods(longer, activity, new Date("2026-10-21T12:00:00Z")).find((p) => p.key === "1m")!;
  assert.deepEqual([oneMonth.start, oneMonth.start_value, oneMonth.net_contributions], ["2026-09-20", 950, 500]);
  assert.deepEqual(periods([snaps[0]!], activity), []);
});

test("series: net invested starts at the first value and adds money moved in on its day", () => {
  const snaps = [{ date: "2026-10-01", value: 1000 }, { date: "2026-10-05", value: 1100 }, { date: "2026-10-09", value: 1550 }];
  const s = series(snaps, [act("2026-09-01", "cash", "deposit", -50), act("2026-10-05", "cash", "deposit", -400), act("2026-10-07", "cash", "withdrawal", 100)]);
  assert.deepEqual(s.map((p) => p.invested), [1000, 1400, 1300]);
});
