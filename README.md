# Fin

Minimal read-only viewer for account balances and transactions, backed by Plaid. Syncs daily for
Ameris, Amex, Wells Fargo and Schwab cash accounts; Schwab brokerage accounts show current value only.

## Setup
1. `cp .env.example .env`; fill in `PLAID_CLIENT_ID` and `PLAID_SECRET` (production secret for real banks).
2. `docker compose up -d --build`, open http://localhost:3000, click **Connect bank** for each institution.
3. The daily sync runs in-process at `SYNC_CRON` (default 06:00, in `TZ`). **Sync now** forces one. Run a single instance only.

Pages: `/` (home dashboard of account values), `/accounts.html` (registers), `/connections.html` (linked banks).

Local dev without Docker: `pnpm install && pnpm dev` (Node >= 22.9).

Deployment follows the same stack pattern as other apps on the host: no published ports; the shared Caddy (docker-proxy labels) reaches the container over the external `apps` network at https://fin.example.com. Set `PLAID_REDIRECT_URI` to that URL (with trailing slash) and register it in the Plaid Dashboard.
The SQLite DB lives in the `fin-data` volume (`/data`): back it up.

## OAuth banks
Wells Fargo, Amex and Schwab use OAuth in production, which requires an **https** redirect URI
registered in the Plaid Dashboard (none is registered yet) and set as `PLAID_REDIRECT_URI`
(it must point to this app's root, e.g. via a Tailscale/Cloudflare tunnel).

Data lives in `$DATA_DIR/fin.db` (contains Plaid access tokens — keep it private).

There is no app-level authentication: restrict access at the network layer (internal hostname / Twingate).
