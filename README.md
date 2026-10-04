# Fin

A small, read-only dashboard of account balances and transactions across a family's banks, backed by [Plaid](https://plaid.com).
A daily sync pulls balances and transactions; brokerage and retirement accounts show a current value only (no register).

## Pages
| URL | What it shows |
|---|---|
| `/` | Dashboard: net worth, cash / investments / owed, and a card per account grouped by owner |
| `/accounts` | Sidebar of owners → account types → accounts, with a searchable, lazily-loaded transaction register |
| `/connections` | Linked banks grouped by institution: health, last sync, per-account owner and show/hide, duplicate detection, rename and unlink |

Owners are detected from Plaid Identity (and can be reassigned per account); accounts are grouped by type automatically.
Credit cards and loans are shown as negative (owed) so totals add up.

## Configuration
Copy `.env.example` to `.env` and fill it in:

| Variable | Purpose |
|---|---|
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | Plaid credentials (`production` for real banks, `sandbox` for testing) |
| `PLAID_REDIRECT_URI` | Required for OAuth banks (Wells Fargo, Amex, Schwab, ...). Must be `https://<your-host>/accounts` and registered under *Allowed redirect URIs* in the Plaid Dashboard |
| `SYNC_CRON`, `TZ` | When the daily sync runs (default `0 6 * * *`) and in which timezone |
| `HOSTNAMES` | Hostname(s) Caddy serves the app on (compose labels) |
| `DATA_DIR`, `PORT` | Database directory (default `data`, `/data` in the container) and listen port |

## Run
```
docker compose up -d --build     # the app listens on 3000 inside the container
pnpm install && pnpm dev         # local development (Node >= 22.9)
pnpm test                        # unit + API tests
pnpm typecheck
```
The compose file follows a Caddy-docker-proxy pattern: no published ports, and the container joins the external `apps` network
so Caddy can route to it from labels. Adjust `docker-compose.yml` if you front it differently.

The daily sync runs inside the server process, so run a single instance. **Sync now** on the accounts page forces one.

## Data and security
- State lives in SQLite at `$DATA_DIR/fin.db` (the `fin-data` volume), including Plaid access tokens. Keep it private and back it up.
- There is no app-level login. Restrict access at the network layer (internal hostname, VPN, Twingate, ...).
- Unlinking a connection revokes it at Plaid (ending billing) and deletes its data here.

## Layout
```
src/app.ts            Express app: clean URLs, static files, routers
src/routes/           link (Plaid Link + sync), accounts, register (transactions/payees), connections
src/sync.ts           Per-connection sync: balances, owners, transactions
src/classify.ts       Account grouping, owner-name normalization, signed balances
src/duplicates.ts     Same account seen through several connections
src/plaidStatus.ts    Cached /item/get status for the Connections page
public/               The three pages plus shared.css / shared.js
test/                 node:test suites (pure logic, API, sync with Plaid stubbed)
```
