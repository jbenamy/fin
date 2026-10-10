# Fin

Read-only family dashboard of bank balances and transactions, backed by Plaid. Node 22.9+/TypeScript server (Express 5,
built-in `node:sqlite`), plain ES-module browser pages (no framework, no bundler). See `README.md` for user-facing docs.

## Commands
```
pnpm dev          # tsx server with .env (Node >= 22.9)
pnpm test         # node:test: logic, API (temp DB), sync with Plaid stubbed
pnpm typecheck    # server (tsconfig.json, strict + noUnused*) AND browser scripts (tsconfig.web.json, non-strict checkJs)
pnpm build        # tsc -p tsconfig.build.json -> dist/ (tests/types excluded)
```
Run `pnpm typecheck && pnpm test` before committing. pnpm 11: `pnpm-workspace.yaml` allow-lists esbuild's build script.

## Architecture
- `src/app.ts` builds the Express app (`createApp()`, no listen/cron so tests can use it); `src/server.ts` adds the daily cron and listens.
- `src/routes/`: `link` (Plaid Link token/exchange, SSE sync), `accounts`, `register` (transactions + payee search), `connections` (status, duplicates, rename, unlink).
- `src/sync.ts` per-connection sync: balances (`accountsGet`) -> owners (`identityGet`, once) -> transactions (`transactionsSync`, cash accounts only). Investment accounts never get transactions.
- **Display rules live on the server.** `src/dto.ts` (`accountDto`) supplies `balance` (credit/loan already negative), `kind` (cash/investment/debt), `group`, `group_rank`. Pages must not re-derive these. `GROUP_ORDER` exists only in `src/classify.ts`.
- **Effective owner = `account_view.owner`** (manual `owner_override`, else Plaid-detected, else "Unassigned"). Query the view, never re-write the COALESCE.
- `src/plaidStatus.ts` caches `/item/get` for 5 min (`?refresh=1` bypasses; sync/unlink/consent invalidate).
- `src/db.ts`: tables + `addColumn` migrations (additive only) + the view. DB is `$DATA_DIR/fin.db`.
- Frontend: `public/*.html` (markup + page CSS), `public/js/` one entry script per page (accounts is split into sidebar/register/link/sync), `public/shared.{js,css}`. Dark theme only.
- Clean URLs: `/accounts`, `/connections`; `*.html` 301-redirects. Always link to the clean form.

## Conventions
- Use `api()` from `shared.js` for JSON requests, `store` for localStorage, `openDialog` for modal forms (cancel buttons carry `data-cancel`), `byName`/`cmp` for sorting (case-insensitive, numeric-aware), `usd` for money.
- Escape everything interpolated into HTML with `esc()`.
- Don't print or log Plaid tokens, secrets, or account owner names/PII in tool output or logs (log request ids and error codes).
- Keep behavior stable when refactoring; the UI was verified with a headless-Chrome snapshot harness (50 states before/after). It is not in the repo; rebuild a CDP-driven one if you do another large frontend change.

## Plaid facts
- Link requests `transactions` (required) plus `investments` and `identity` if supported. `products` is an intersection filter, so adding required products hides banks. Plaid rejects a token with no product.
- OAuth banks (Wells Fargo, Amex, Schwab) need `PLAID_REDIRECT_URI=https://<host>/accounts` registered in the Plaid Dashboard; Link resumes on `/accounts` via `resumeOAuth()`.
- Billing is per Item (one login at one institution). The account was approved for full Production access in Oct 2026, so the Free Trial's 10-Item cap no longer applies. Unlink calls `itemRemove` (ends billing) then deletes local rows.
- Brokerage/401(k)/IRA accounts are balance-only by design.

## Deployment
- Host `user@your-host.example.com`, stack dir `/opt/stacks/fin`, compose project `fin`, volume `fin_fin-data` (DB at `/data/fin.db`). URL `https://fin.example.com` (internal, Twingate-only, via the shared Caddy docker-proxy on the external `apps` network; no published ports).
- Deploy: rsync the repo (`--delete`, excluding `node_modules data dist .env .git test`), then `docker compose up -d --build` in `/opt/stacks/fin`. `.env` lives only on the VM (mode 600); never copy secrets into the repo.
- **Use one multiplexed SSH connection per deploy** (`-o ControlMaster=auto -o ControlPath=/tmp/sa-%C -o ControlPersist=...`). Several rapid separate connections have hung or been dropped. If ssh reports "The agent has no identities", the local SSH key agent needs unlocking; retrying won't help.
- Verify a deploy by hashing `dist/` and `public/` inside the container against a fresh local `pnpm build`.

## Gotchas
- There is **no app authentication** (removed deliberately); access control is network-level. Plaid access tokens are stored in plaintext in SQLite.
- Daily sync runs in-process: run a single instance.
- `signedBalance` avoids `-0` (it formats as "-$0.00").
- TypeScript 7: `baseUrl` is removed; `paths` entries need a leading `./`.
- Node's `dialog` `close` event fires asynchronously, so handlers on it run a tick after the click.
