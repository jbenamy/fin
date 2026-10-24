# Plaid plan

## Goal

Add an investment holdings table, allocation summary, and daily balance/holdings snapshots to the existing family
dashboard (Fin), using /investments/holdings/get. (workflow_id: wf_45b4e4fe445b3480)

## Scope

- Products:
  - transactions (`products`): cash and card activity; daily balances come with /accounts/get (SELECT-001, SELECT-005).
  - identity: removed 2026-10-24 (no longer requested or called); owners are assigned by hand per account.
  - investments (`additional_consented_products`): holdings for brokerage/retirement accounts, plus the existing
    /investments/transactions/get for cash management registers (INV-010, INV-015).
- Rejected: investments in `required_if_supported_products` (the previous setting): it bills the Holdings
  subscription at Item creation even for bank-only logins (CONV-002, INV-002). Liabilities: not needed by the
  dashboard today (credit/loan balances come from /accounts/get). /investments/refresh: per-call billing, and the
  daily sync matches Plaid's 1-4x/day refresh (INV-006).
- Platform: Node/TypeScript (Express 5, SQLite) server; plain ES-module browser pages; Plaid Link web SDK.
- Environment: Production (already approved for transactions and investments in the US).

## Human tasks

| Task | Why it matters | Where | State |
|------|----------------|-------|-------|
| Investments enabled for US Production | holdings calls fail without it | https://dashboard.plaid.com/settings/team/products | verified (2026-10-23) |
| OAuth redirect URI registered | OAuth banks in Link | https://dashboard.plaid.com/developers/api | verified (2026-10-23) |
| Webhooks | not used: a daily cron syncs instead (INV-006 refresh cadence is daily-ish) | n/a | not_applicable |

## Implementation checklist

- [x] `holdings`, `balance_history`, `holding_history` tables (`src/db.ts`)
- [x] Sync phase: /investments/holdings/get for Items with investment accounts; securities joined locally on
      security_id (INV-001); fresher of institution vs close price (INV-007); cash equivalents as holdings;
      per-field degradation for cost basis / vested (INV-009); unavailable codes keep previous rows (`src/sync.ts`)
- [x] Daily snapshots of every balance and position (UTC date, overwritten within a day)
- [x] `GET /api/holdings?account=` with allocation by asset class (`src/routes/holdings.ts`)
- [x] Account page: allocation bar + legend, holdings table with stale-price flag (`public/js/holdings.js`)
- [x] Unlink deletes holdings and history
- [x] Link: investments moved to `additional_consented_products` (INV-015)
- [ ] Later: value-over-time chart from the history tables; owner/family-wide allocation

## Acceptance

- Round 0 (2026-10-23): FAIL on three items, all outside the holdings change:
  - CHECK-004: no Reconnect (update mode) for ITEM_LOGIN_REQUIRED; update mode is not used (it was only for Identity consent, now removed).
  - CHECK-008: not run against Plaid Sandbox (Plaid stubbed in tests; UI checked on a seeded DB).
  - CHECK-014: freshness comes from the daily cron + Sync now, not HOLDINGS / SYNC_UPDATES_AVAILABLE webhooks.

## Maintenance

This integration is maintained with the Plaid MCP; this file is its durable state. Agents working in this
repository: consult build_guidance before modifying any Plaid-touching code, and re-run build_check_acceptance
before reporting such a change as working. The acceptance above applies only to the code as it was verified —
later changes invalidate it.

## How to test

### Holdings

1. `pnpm test` (sync and API tests stub Plaid).
2. After deploying, press **Sync now** on /accounts; the summary for an investment bank lists "N holdings".
3. Open a brokerage/IRA/401(k) account: an Allocation bar and a Holdings table appear under the market value.
   An Item linked minutes ago may show "Holdings appear after the next sync" (PRODUCT_NOT_READY).

## Decisions made

- Holdings table + allocation summary per account, plus daily snapshots (confirmed by the developer, 2026-10-23).
- Investments moved to additional_consented_products for new links (Claude, per INV-015; existing Items unchanged).

## Open questions

- Keep the daily cron as the sync mechanism, or add webhooks (needs a public receiver; the app is Twingate-only)?
- Add a Reconnect button (update mode) for Items in ITEM_LOGIN_REQUIRED?
