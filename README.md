# Ledger

Ledger is a private, self-hosted personal-finance app for Cloudflare. It connects US bank and credit-card accounts through Plaid, stores accounts and transactions in Cloudflare D1, and presents a unified owner-only ledger with triage, notes, category filters, and optional credit-card benefit tracking.

This open-source edition intentionally contains:

- **Accounts** — connect banks, sync balances, reorder cards, reconnect Items.
- **Transactions** — paginated list, year/month/bank/account/category/triage filters, swipe triage, notes, detail overlays.
- **Benefits** — credit-card benefit templates and per-period tracking (calendar-year MVP).

It intentionally does **not** ship personal bank data, production resource IDs, domains, email addresses, Plaid credentials, Cloudflare secrets, or real card last-4 mask overrides.

## Stack

- React 19 and Next.js App Router syntax
- vinext / Vite for Cloudflare Workers
- Cloudflare Workers, static assets, and Images
- Cloudflare D1 (SQLite) via Drizzle
- Cloudflare Access with Google as the identity provider
- Plaid Link + Transactions Sync API

## Start here

For a new Cloudflare deployment, follow [DEPLOYMENT.md](./DEPLOYMENT.md) from top to bottom. It is written so another coding agent can perform the deployment without private project context, and it marks domain purchase, interactive login, secret handling, remote migrations, Plaid dashboard steps, and production approval as explicit human checkpoints.

For architecture, data flow, API behavior, database design, authentication, and implementation details, see [technical.md](./technical.md).

For local development after configuration:

```bash
pnpm install
cp .env.local.example .env.local
# fill PLAID_* in .env.local; fill wrangler.toml placeholders for local Miniflare as needed
pnpm exec wrangler d1 migrations apply ledger --local --config wrangler.toml
pnpm run dev
```

Local requests still go through the Worker entry. Without a valid Access JWT, production-style auth rejects requests. Prefer following `DEPLOYMENT.md` for a real hostname, or use sandbox credentials only on a machine you control.

## Commands

```bash
pnpm run dev                  # local development
pnpm run build                # production build
pnpm run test                 # currently runs production build
pnpm run lint                 # ESLint
pnpm run db:generate          # generate schema migrations after schema changes
pnpm run deploy               # vinext build && wrangler deploy --config wrangler.toml
```

Apply remote migrations with Wrangler after human approval:

```bash
pnpm exec wrangler d1 migrations apply ledger --remote --config wrangler.toml
```

## Data ownership

All account and transaction data lives in the deployer's own D1 database. Plaid access tokens are encrypted at rest with a key derived from `PLAID_SECRET` and never returned to the browser. Browser storage is only used for temporary Plaid Link OAuth state, not as the primary data store.

## License

[MIT](./LICENSE)
