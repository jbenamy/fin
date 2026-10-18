# Fin

Read-only family dashboard of bank balances and transactions, backed by Plaid. Node 22.9+/TypeScript server (Express 5,
SQLite via `better-sqlite3-multiple-ciphers`), plain ES-module browser pages (no framework, no bundler). See `README.md` for user-facing docs.

## Commands
```
pnpm dev          # tsx server with .env (Node >= 22.9)
pnpm test         # node:test: logic, API (temp DB), auth (software passkey in test/webauthn.ts), sync with Plaid stubbed
pnpm typecheck    # server (tsconfig.json, strict + noUnused*) AND browser scripts (tsconfig.web.json, non-strict checkJs)
pnpm build        # tsc -p tsconfig.build.json -> dist/ (tests/types excluded)
```
Run `pnpm typecheck && pnpm test` before committing. pnpm 11: `pnpm-workspace.yaml` allow-lists esbuild's build script.

## Architecture
- `src/app.ts` builds the Express app (`createApp()`, no listen/cron so tests can use it); `src/server.ts` adds the daily cron and listens.
- `src/routes/`: `auth` (passkey login, invites, passkey list/remove), `link` (Plaid Link token/exchange, SSE sync), `accounts`, `register` (transactions + payee search), `connections` (status, duplicates, rename, unlink).
- **Passkey login guard** (`src/auth.ts`, `requireSession`): runs before static files and routers. Only `/healthz`, `/login` + the files it loads (the `PUBLIC` set), and `/api/auth/*` are open; pages redirect to `/login?next=...`, the API answers 401 (and `api()` sends the browser to `/login`). No user accounts: any registered passkey signs in. Sessions are 30-day sliding cookies (`fin_session`, sha256 stored in `sessions`). A new page that the login page needs must be added to `PUBLIC`.
- `src/sync.ts` per-connection sync: balances (`accountsGet`) -> owners (`identityGet`, once) -> transactions (`transactionsSync`, cash accounts only). Investment accounts never get transactions.
- **Display rules live on the server.** `src/dto.ts` (`accountDto`) supplies `balance` (credit/loan already negative), `kind` (cash/investment/debt), `group`, `group_rank`. Pages must not re-derive these. `GROUP_ORDER` exists only in `src/classify.ts`.
- **Effective owner = `account_view.owner`** (manual `owner_override`, else Plaid-detected, else "Unassigned"). Query the view, never re-write the COALESCE.
- Connection labels (`connectionInfo()` in `routes/connections.ts`) tell apart several logins at one bank: nickname, else all owners on the login, else the item-id tail. `/api/accounts` gives each account its own `connection` label (nickname, else that account's owner) so cards never list everyone on a shared login; the Connections page keeps the login-wide label.
- `src/plaidStatus.ts` caches `/item/get` for 5 min (`?refresh=1` bypasses; sync/unlink/consent invalidate).
- `src/db.ts`: `openDb` + tables + `addColumn` migrations (additive only) + the view. DB is `$DATA_DIR/fin.db`, encrypted
  (ChaCha20, SQLite3MultipleCiphers) when `DB_KEY` (64 hex chars) is set; a plaintext DB is encrypted in place on the
  first start with a key, and a wrong/missing key fails at startup. Tests and `pnpm dev` run without a key. The
  package's `exports` lacks types, hence `src/better-sqlite3-multiple-ciphers.d.ts`; it ships prebuilt binaries, so
  `allowBuilds` disables its node-gyp script.
- Frontend: `public/*.html` (markup + page CSS), `public/js/` one entry script per page (accounts is split into sidebar/register/link/sync; `webauthn.js` is shared by `login` and `passkeys`), `public/shared.{js,css}`. Dark theme only.
- Clean URLs: `/accounts`, `/connections`, `/passkeys`, `/login`; `*.html` 301-redirects. Always link to the clean form.

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
- Host `user@your-host.example.com` (placeholder: the repo is public; the real host is the one in `~/.ssh/config`, user root, and is not recorded here), stack dir `/opt/stacks/fin`, compose project `fin`, DB bind-mounted from `/opt/stacks/fin/data` (`/data/fin.db` in the container) so the Kopia stack, which backs up `/opt/stacks`, includes it. Don't move it to a named volume: that silently drops it from backups (happened 2026-10-16 to 10-18). URL `https://fin.example.com` (internal, Twingate-only, via the shared Caddy docker-proxy on the external `apps` network; no published ports).
- Deploy: rsync the repo (`--delete`, excluding `node_modules data dist .env .git test`), then `docker compose up -d --build` in `/opt/stacks/fin`. `.env` lives only on the VM (mode 600); never copy secrets into the repo.
- Secrets: `.env` on the VM holds `op://<host vault>/fin/PLAID_...` references (one 1Password vault named after the host,
  one item per stack, fields named after the env vars); `fin-entrypoint.sh` resolves them with `op read` before
  exec'ing node, using the read-only service-account token at `/etc/op/token` (uid 1000, mode 400, outside the
  rsync'd stack dir), mounted as the `op_token` compose secret. Families-plan rate limit is 1,000 requests/day.
- **Use one multiplexed SSH connection per deploy** (`-o ControlMaster=auto -o ControlPath=/tmp/sa-%C -o ControlPersist=...`). Bursts of separate connections used to hang: the home router's IPS flags rapid outbound
  port-22 SSH as scanning and blocks it for minutes (ping still works). `~/.ssh/config` now routes the host over
  WireGuard and GitHub over port 443; if SSH hangs again, check the router's blocked flows before the VM. If ssh reports "The agent has no identities", the local SSH key agent needs unlocking; retrying won't help.
- Verify a deploy by hashing `dist/` and `public/` inside the container (`docker compose exec -T app`, workdir `/app`; no wget/curl in the image) against a fresh local `pnpm build`. The healthcheck takes ~30s to leave "starting".

## Gotchas
- Auth is passkeys (WebAuthn via `@simplewebauthn/server`) on top of network-level access. While **no passkey exists**, anyone who reaches the app can create the first one; after that, new passkeys need a session or a one-time 24 h invite link. Removing the last passkey is refused for that reason. Passkeys are bound to the hostname (RP id): moving to a new host means re-enrolling, and a passkey made on one of several `HOSTNAMES` works only there. Plaid access tokens are in SQLite (encrypted at rest when `DB_KEY` is set).
- WebAuthn challenges live in memory (5 min); a restart mid-ceremony just means "try again".
- Daily sync runs in-process: run a single instance.
- `signedBalance` avoids `-0` (it formats as "-$0.00").
- TypeScript 7: `baseUrl` is removed; `paths` entries need a leading `./`.
- Node's `dialog` `close` event fires asynchronously, so handlers on it run a tick after the click.
