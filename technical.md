# Ledger technical notes

> Open-source technical reference. For a greenfield Cloudflare install, follow `DEPLOYMENT.md` first.
> Worker name: `ledger`. D1 binding must remain `DB` (example database name: `ledger`).
> Deploy: `pnpm run deploy` (`vinext build && wrangler deploy --config wrangler.toml`).

This document is for engineers and coding agents who maintain Ledger. The goal is that a new owner can understand product boundaries, data flow, critical implementation details, deployment, and current tech debt without re-excavating the whole repo.

**Important:** self-hosted Cloudflare Workers + D1. Read `AGENTS.md` and `DEPLOYMENT.md` before changing auth, data, or deploy config. This file covers architecture and implementation detail.

Before any change, in order:

1. Read root `AGENTS.md`; its safety and product constraints take priority.
2. Read `DEPLOYMENT.md` (when the task touches deploy) and sections 19–20 of this document.
3. Read the rest of this document and cross-check current source; do not assume docs and code are fully in sync.
4. Check `git status`; do not overwrite uncommitted work from the user or another agent.
5. Read the source files directly related to the task.
6. If you change architecture, data model, routes, deploy path, or security boundaries, update this document and `AGENTS.md`.

## 1. Product goals and current scope

Ledger is an owner-only personal finance web app that aggregates US bank checking, savings, and credit card accounts and their transactions via Plaid.

Already implemented:

- Connect banks via Plaid Link; Production OAuth redirect; Item reconnect (update mode).
- First import and incremental sync via Plaid `/transactions/sync` (plus `/accounts/get` for full account coverage).
- Plaid Items, accounts, transactions, and credit-card benefit templates persisted in self-managed Cloudflare D1 (`ledger`).
- Three main tabs: Accounts / Transactions / Benefits (bottom nav); Connect bank and Sync live on Accounts.
- Collapsible bank groups, static institution icons, card-face art, account sorting, account/transaction detail overlays.
- Transaction notes, triage (`untriaged` / `recognized` / `questioned`), filters, and swipe actions.
- Benefits: template-grouped matrix, per-card detail, template create/edit, Assign for unassigned cards.
- Client-side tab switching (`history.pushState`); detail/template screens support iOS gesture-back without blanking the underlying list.
- Server-side pagination (transactions default 50 per page); owner-only Cloudflare Access + Worker JWT defense in depth.

Not included:

- Multi-user data isolation.
- Scheduled sync or Plaid webhooks.
- Budgets, category editing, reports, search, or export.
- Automatic Item error detection UI, or a disconnect-bank entry point.
- Branded favicon (still the scaffold default; top-bar brand-mark is a green serif L).

This is a private MVP. Do not expand it into a public or multi-user product without explicit authorization.

## 2. Tech stack

| Layer | Technology | Notes |
| --- | --- | --- |
| UI | React 19, Next.js App Router | Pages query on the server; interaction lives in client components |
| Build | vinext, Vite 8 | Cloudflare Worker–compatible output |
| Styles | Single `app/globals.css` | Tailwind is imported, but current UI mostly uses hand-written classes |
| Icons | `lucide-react` | Flat line icons for bottom nav, etc. |
| Drag and drop | `@dnd-kit/*` | Account reorder with pointer and keyboard sensors |
| ORM | Drizzle ORM | Server reads use Drizzle; sync writes mostly use D1 prepared SQL |
| Database | Cloudflare D1 / SQLite | Binding name is fixed as `DB` |
| Bank aggregation | Plaid Transactions API | Environments: `sandbox` and `production` |
| Hosting | Cloudflare Workers + D1 | Root `wrangler.toml`; Access authenticates at the edge |
| Package manager | pnpm 11 | Node.js `>=22.13.0` |

## 3. Repository layout

```text
ledger/
├── AGENTS.md                         # Agent contract / safety rules
├── DEPLOYMENT.md                     # Greenfield Cloudflare deploy guide
├── technical.md                      # This architecture document
├── README.md                         # Product overview
├── LICENSE                           # MIT
├── .env.local.example                # Local Plaid env template (copy to .env.local)
├── app/
│   ├── page.tsx                      # Server entry: parallel load accounts/institutions/txns/benefits, filter + page
│   ├── transaction-dashboard.tsx     # Accounts / Transactions tabs, detail overlays, connect/sync
│   ├── benefits-panel.tsx            # Benefits tab: matrix, per-card detail, template create/edit
│   ├── globals.css                   # All product styles
│   ├── layout.tsx                    # Metadata, fonts, root layout
│   ├── access-auth.ts                # Reads worker-verified owner headers
│   └── api/
│       ├── accounts/{reorder,display-mask}/
│       ├── transactions/{note,triage}/
│       ├── benefits/**               # products / defs / assign / periods bundle
│       └── plaid/
│           ├── link-token/route.ts
│           ├── exchange/route.ts
│           ├── sync/route.ts
│           └── institutions/refresh/route.ts
├── db/
│   ├── schema.ts                     # Drizzle schema
│   └── index.ts                      # D1 Drizzle client
├── lib/
│   ├── plaid.ts                      # Plaid HTTP client, brand metadata, token encrypt/decrypt
│   ├── sync.ts                       # Full /transactions/sync incremental logic
│   └── cloudflare-access.ts          # Verifies Cf-Access-Jwt-Assertion
├── drizzle/                          # Generated migrations
├── scripts/apply_migrations_remote.sh # Fallback: apply migrations via D1 HTTP API when wrangler is unavailable
├── worker/index.ts                   # Cloudflare Worker entry; sole Access JWT check
├── wrangler.toml                     # Production deploy: account_id + ledger D1
├── vite.config.ts                    # vinext + Cloudflare plugins; local placeholder D1 binding
├── drizzle.config.ts                 # SQLite migration config
└── package.json                      # name: ledger; deploy = vinext build && wrangler deploy
```

## 4. Runtime architecture

**Current production path (self-managed Cloudflare Workers):**

```text
Authenticated browser (Google account)
        │
        ▼
Cloudflare Access (protects ledger.example.com, Google IdP, Allow-policy email allowlist)
        │ writes Cf-Access-Jwt-Assertion header
        ▼
worker/index.ts (sole entry)
        │ authenticateAccessRequest(): verify JWT signature/issuer/audience/email
        │ pass → inject x-ledger-owner-email/subject; fail → 403
        ▼
vinext / Next.js App Router on Cloudflare Worker "ledger"
        │
        ├── app/page.tsx ───────────────► D1 binding: DB → ledger
        │
        └── /api/* ─────────────────────► Plaid / D1 (all behind Access)
```

`worker/index.ts` hands most requests to vinext’s app-router handler and only special-cases `/_vinext/image`; Access JWT verification runs first. App code reads D1 and hosted secrets from `env` via `cloudflare:workers`.

### Identity and access boundary

- Cloudflare Access (Application name `Ledger Owner`, protects `ledger.example.com`) intercepts unauthenticated requests at the edge and redirects to Google login; the Allow policy only admits emails listed in `ACCESS_ALLOWED_EMAILS`.
- `worker/index.ts` uses `authenticateAccessRequest()` from `lib/cloudflare-access.ts` to re-verify JWT signature, issuer (team domain), and audience (Access Application AUD). This is the Worker’s only request entry and covers every page and API route.
- After verification, the Worker passes identity to the app via internal headers `x-ledger-owner-email` / `x-ledger-owner-subject`; `getLedgerOwner()` in `app/access-auth.ts` reads those internal headers. App code must not trust `cf-access-*` or any client-controlled header directly.
- Logout uses Cloudflare Access `/cdn-cgi/access/logout`.
- The database has no `user_id` column; every row belongs to the single owner. Do not describe this as a multi-user security model. Do not widen the Access Allow policy or make the site public without explicit user approval.

(Historical notes on the OpenAI Sites migration are in section 19; the Sites project and in-repo Sites/ChatGPT dependencies were removed on 2026-08-03.)

## 5. Pages and interaction

### 5.1 Route state and client navigation

The product has a single root page. **Filters/pagination** are driven by the query string and server-rendered; **tab switches** use client `history.pushState` / `replaceState` and do not full-page reload.

| Param | Values | Default |
| --- | --- | --- |
| `tab` | `accounts`, `transactions`, `benefits` | `accounts` |
| `page` | Positive integer | `1` |
| `institution` | Plaid `item_id` or `all` | `all` |
| `account` | Plaid `account_id` or `all` | `all` |
| `triage` | `all` / `untriaged` / `recognized` / `questioned` | `all` |
| `categoryPrimary` | PFC primary, `all`, `uncategorized` | `all` |
| `categoryDetailed` | PFC detailed, `all`, `uncategorized` | `all` |
| `year` | **Transactions tab**: transaction date year (`YYYY`); **Benefits tab**: benefit calendar year | Transactions default `all`; Benefits default current calendar year |
| `month` | Transactions date month (`01`–`12`) or `all`; Transactions tab only | `all` |

Examples:

```text
/?tab=transactions&page=2&institution=<item_id>&account=<account_id>&triage=untriaged&year=2025&month=03
/?tab=benefits&year=2026
```

If both institution and account are provided, the server prefers the account filter. On the Transactions tab, `year`/`month` filter on `transactions.date` (`YYYY-MM-DD`); on Benefits, the same `year` key means benefit calendar year (see `app/page.tsx` branch by `tab`).

**Detail / template gesture-back contract (important):**

When opening account detail, transaction detail, card-benefit detail, or template create/edit:

1. Push history with `History.prototype.pushState` (state `{ __NA: true, ledgerDetail|ledgerBenefitsOverlay }`, plus a `view=` query). **Do not** `replaceState(null)` before `pushState`—that clears the previous-page snapshot iOS uses for edge swipe.
2. Render detail as a `position:fixed` `.detail-panel`; keep the underlying list/tab **mounted** and add `.is-covered` (pointer-events only; do not make the list itself fixed).
3. Back button and system gesture both call `history.back()`; `popstate` clears the matching selection. When switching tabs while detail history is still present, collapse with `replaceState` so no ghost entries remain.

**Scroll root must be `.app-scroll`, not `window` (verified 2026-08-03):**

- Layout: `html, body { height:100%; overflow:hidden }`; `.app-shell` is column flex + `100dvh`; top/bottom bars have fixed height inside the shell; **only** `.app-scroll` (`flex:1; overflow-y:auto`) scrolls the list. Therefore `window.scrollY` is always `0`.
- On open detail: `html.ledger-detail-open` sets `.app-scroll` to `overflow:hidden` and saves/restores its `scrollTop` (`appScrollRef` / `coverScrollYRef`). `history.scrollRestoration = "manual"`.
- **Root cause:** iOS Safari edge-swipe back uses a window screenshot of the previous history entry. With **document/`window` scrolling**, when the user is not at the top (`scrollY > 0`), the previous-page peek is often a blank paper-colored frame; at the top (`scrollY === 0`) it looks “fine.” Moving scroll into an inner container means the window itself is not scrolled when the snapshot is taken, so mid-list content is captured correctly.
- **Ineffective / abandoned fixes (do not retry):** only pinning the list with `position:fixed` + negative `top` / `translateY`; `body { position:fixed; top:-scrollY }`; `pushState` after freeze. Those treat symptoms; the bug is the screenshot coordinate system, not the underlayer’s live DOM.
- Do not rely on React state alone and unmount the list, then depend on the browser snapshot—that was an earlier blank-root cause (list not in the DOM at all).

The top-right avatar menu can show Cloudflare `CF_VERSION_METADATA.id` (matches the Current Version ID from `wrangler deploy`) to confirm production is on the latest build.

### 5.2 Accounts tab

- All bank groups start collapsed; expand state is React-only and not persisted. No expand-arrow icon (users discover toggle by tapping the bank row).
- Accounts are queried as `institution_name ASC, sort_order ASC, account_name ASC`; the client groups by institution via `itemId`.
- Bank icons prefer static assets in `lib/institution-icons.ts` (`/institution-icons/*.png`), else Plaid logo / initials.
- Credit cards prefer card-face art from `lib/card-art.ts` (`/card-art/*.png`); matching uses mask override + name keywords.
- Bank title is two lines: `{bank name} · {N credit · M cash …}`; second line is status dot + synced time. Reconnect is a `Link2` icon button (do not use `RefreshCw`, to avoid confusion with Sync).
- Sync / Add bank sit in the Accounts title toolbar; there is no separate Settings tab.
- Tapping an account opens a detail overlay (balances, type, official name, updated time; Amex can edit `display_mask` last five digits).
- Drag reorder is allowed only within the same institution + same bucket (credit/cash/investment/other); failures roll back.

Top balance definitions:

- `Cash`: `subtype` `checking`/`savings` with non-null current.
- `Invest`: sum of current for investment-class accounts.
- `Credit`: sum of current for `type=credit` (amount owed, not available credit).
- Amounts are milliunits; display ÷ 1000; currently formatted as USD.

### 5.3 Transactions tab

- `PAGE_SIZE = 50` (`app/page.tsx`).
- Filters: Year, Month, bank, account, Category primary, Category detailed (cascading; options from distinct DB values), Triage four-segment slider. `uncategorized` filters rows with no category. Year/Month may be used alone or together; Month-only matches that month in every year.
- Sort: `date DESC, transaction_id DESC`; grouped by date within the page.
- Row gestures: swipe right → recognized (green check); swipe left → questioned (red ?); row background follows triage.
- Note: expandable inline in the list; on detail, in the fields table (two rows: Triage slider / Note icon → in-place edit); save on blur; flush before leaving detail.
- Detail overlay + gesture-back same as §5.1; opening detail locks `.app-scroll` via `html.ledger-detail-open` (not window); inputs use `visualViewport` so the keyboard does not cover them.
- Local `transactionPatches` merge note/triage so the full table need not refetch; under an active filter, rows that no longer match after triage change are removed from the current list.

### 5.4 Benefits tab

Credit-card benefit tracking (four dedicated tables; does not rewrite Plaid tables):

- **Data:** `card_products` + `benefit_defs` (templates; benefits can be renamed/appended, not deleted individually); `benefit_assignments` (account→product); `benefit_periods` (card × year × periodKey → `available|used|missed|n/a`).
- **Cadence:** monthly / quarterly / semi_annual / annual; MVP is calendar year only; `effective_from/to_year|period` support mid-year windows; narrowing that would hit an already-`used` period returns API 409.
- **Main view:** matrix only. One panel per assigned card’s template, title `{name} ({n})`, Pencil top-right opens that template’s edit page; card row order follows Accounts `sort_order`; sticky left card column shows art + mask + used count.
- **Unassigned:** `No template` list under the matrix; Assign or Create template.
- **+ Template:** top button opens create-template overlay (not a “manage all templates” page).
- **Per-card detail:** tap a card row; period chips cycle status; Remove template available.
- Do **not** put Year selector and + Template in the same visual box (avoids implying templates are year-scoped).
- Gesture-back contract same as §5.1 (`ledgerBenefitsOverlay`).

### 5.5 Connect bank and Sync (formerly Settings)

- Plaid Link CDN loaded dynamically; OAuth stashes link token in `localStorage`.
- Add bank → new-connection Link token → exchange → first sync.
- Sync → `POST /api/plaid/sync` syncs all Items in order.
- Reconnect (per-bank `Link2`) → update-mode Link token (with `itemId`) → sync on success. Does not re-exchange the access token.

## 6. Server queries and pagination

`app/page.tsx` is the main server component:

1. Parse tab / page / institution / account / triage / category / year / month.
2. Load **in parallel**: accounts (with institution join), institution list, transaction count, **current page of transactions**, **benefits bundle** (and `ensurePeriodsForYear`).
3. Transactions and benefits load **regardless of current tab**—so client tab switches need no extra network wait.
4. Transaction query: `LIMIT 50 OFFSET ...`; filters include triage.
5. Results go to `TransactionDashboard` (which passes creditAccounts + benefitsBundle to `BenefitsPanel`).
6. On D1 errors: empty data + database pending banner.

Keep filtering, sorting, and pagination in D1 for further development.

## 7. Data model

Authoritative schema is in `db/schema.ts`; migrations live in `drizzle/`. All amounts are integer milliunits.

### 7.1 `plaid_items`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer PK | Local autoincrement; unused by business logic today |
| `item_id` | text unique | Plaid Item ID; business primary key |
| `institution_id` | text nullable | Plaid Institution ID |
| `institution_name` | text | Display name |
| `institution_logo` | text nullable | base64 PNG data URI; can inflate D1 row size |
| `institution_primary_color` | text nullable | Plaid brand color |
| `access_token_ciphertext` | text | Encrypted Plaid access token |
| `sync_cursor` | text nullable | Incremental cursor for `/transactions/sync` |
| `status` | text | Mostly `active` today |
| `created_at` | ISO text | Created at |
| `updated_at` | ISO text | Last update/sync time |

### 7.2 `accounts`

| Column | Type | Notes |
| --- | --- | --- |
| `account_id` | text PK | Plaid Account ID |
| `item_id` | text | Linked Plaid Item; indexed, no SQLite FK |
| `name` / `official_name` | text | Display name and official name |
| `mask` | text nullable | Plaid trailing mask, not full card number |
| `display_mask` | text nullable | User-entered display mask (Amex last 5); UI prefers over `mask` |
| `type` / `subtype` | text | e.g. `credit`, `depository` / `checking`, `savings` |
| `current_balance_milliunits` | integer nullable | current balance × 1000 |
| `available_balance_milliunits` | integer nullable | available balance × 1000 |
| `iso_currency_code` | text nullable | Usually `USD` |
| `sort_order` | integer | User drag order |
| `updated_at` | ISO text | Last sync time |

### 7.3 `transactions`

| Column | Type | Notes |
| --- | --- | --- |
| `transaction_id` | text PK | Plaid Transaction ID |
| `account_id` / `item_id` | text | Query/filter association; both indexed |
| `name` | text | Plaid transaction name |
| `merchant_name` | text nullable | Normalized merchant name |
| `original_description` | text nullable | Raw description |
| `amount_milliunits` | integer | Plaid amount × 1000 |
| `iso_currency_code` | text nullable | Transaction currency |
| `date` | `YYYY-MM-DD` text | Primary transaction date; indexed |
| `authorized_date` | text nullable | Authorized date |
| `pending` | integer boolean | Pending flag |
| `category_primary` / `category_detailed` | text nullable | Personal Finance Category v2; both indexed |
| `payment_channel` | text nullable | Payment channel |
| `logo_url` / `website` | text nullable | Plaid enrichments |
| `note` | text nullable | Private user note; UI max 500 |
| `triage` | text not null | `untriaged` (default) / `recognized` / `questioned`; indexed |
| `updated_at` | ISO text | Write/update time |

### 7.4 Benefits tables (`0004`+`0005`)

| Table | Role |
| --- | --- |
| `card_products` | Card product templates (name + timestamps) |
| `benefit_defs` | Benefit defs under a template: amount_milliunits, cadence, effective_from/to_year|period, sort_order |
| `benefit_assignments` | `account_id` → `product_id` (at most one template per card; unique on account_id) |
| `benefit_periods` | Status row per card × benefit × year × period_key; status default `available`; optional note |

There are no explicit foreign-key constraints and no user-ownership columns.

## 8. Plaid integration

### 8.1 Environment variables

Document names only; never write values into docs, code, or Git:

| Variable | Purpose |
| --- | --- |
| `PLAID_CLIENT_ID` | Plaid client ID |
| `PLAID_SECRET` | Secret for the current Plaid env; also used to derive the token encryption key |
| `PLAID_ENV` | `sandbox` or `production` |

Local values live in gitignored `.env.local`. Production values are managed with `wrangler secret put`. Do not print, echo after reading, or commit these values.

### 8.2 Plaid HTTP wrapper

`lib/plaid.ts` does not use the Plaid SDK; it `fetch`es:

```text
https://{PLAID_ENV}.plaid.com{path}
```

Each body automatically includes `client_id` and `secret`. Errors should only surface Plaid’s `display_message` or `error_message`; do not log full response bodies.

### 8.3 Access token encryption

- Algorithm: AES-GCM.
- IV: 12 random bytes per encryption.
- Ciphertext storage: `base64(IV || ciphertext+auth_tag)`.
- Key derivation: SHA-256 of `ledger-plaid-token:v1:${PLAID_SECRET}`, imported as an AES-GCM key.
- Plaintext tokens exist only in Worker memory for Plaid calls and are never returned to the client.

**Important:** rotating `PLAID_SECRET` makes existing `access_token_ciphertext` undecryptable. Plan token re-encryption or user reconnect before rotating; do not swap the secret and assume old Items still sync.

### 8.4 Link token and OAuth

`POST /api/plaid/link-token` optional body `{ itemId }`:

- Without `itemId` (new connection): product `transactions`; country `US`; language `en`; history request `730` days.
- With `itemId` (reconnect / update mode): load that Item’s `access_token_ciphertext` from D1, decrypt, pass as `access_token` to `/link/token/create`; do **not** send `products`/`transactions` (Plaid update-mode requirement). Missing `itemId` → 404.
- In production, both cases set `redirect_uri` to the current request origin + `/`

Register the Production redirect URI in the Plaid Dashboard as:

```text
https://ledger.example.com/
```

Because the code builds the redirect URI from the current Host, start Production Link from `ledger.example.com`.

### 8.5 First-connect flow

```text
Settings opens
  → POST /api/plaid/link-token
  → Plaid Link opens
  → user authenticates bank
  → public_token returned to browser
  → POST /api/plaid/exchange
  → /item/public_token/exchange
  → encrypt access_token
  → fetch institution brand metadata
  → upsert plaid_items
  → syncItem(cursor = null)
  → load Accounts tab
```

### 8.6 Incremental sync

`syncItem` in `lib/sync.ts`:

1. Decrypt the Item access token.
2. Call `/accounts/get` and upsert **all** non-closed accounts for the Item (see “account backfill” below).
3. Read and use that Item’s `sync_cursor` from D1; first sync is null.
4. Loop `/transactions/sync` until `has_more = false`.
5. Each page also upserts accounts from the response (refreshes balances for accounts with activity).
6. Merge `added` and `modified`, then upsert transactions.
7. Delete `removed` transaction IDs.
8. Persist the final `next_cursor` and update Item status/time.

**Account backfill (important bug fix):** Plaid docs say the `accounts` field on `/transactions/sync` responses “Only accounts that have associated transactions will be shown”—so an account with no activity in the sync window (rarely used card, newly opened card) never appears on any page of `/transactions/sync`, and relying only on that field means the account is never written to `accounts`. That once caused a 13-subaccount Amex Item to sync only 12 accounts; it was a pre-migration logic bug, unrelated to Sites/Workers. The fix is an extra `/accounts/get` at the start of each `syncItem` (free, not transaction-dependent, no extra product) to upsert the full account list. If an account is still missing afterward, the user likely did not select it during Plaid Link; use Reconnect (update mode) to re-run account selection.

Transaction upserts batch 80 rows per `D1.batch` to keep statement peaks down. Accounts also use batch per sync page.

Invariants that must hold:

- Handle `added`, `modified`, and `removed`.
- Persist the final cursor only after the full pagination round completes.
- Never wipe tables or re-pull full history every sync.
- Modified upserts must not accidentally overwrite `item_id`; transaction IDs are treated as stably belonging to the original Item.

Current `/api/plaid/sync` syncs Items sequentially and returns only added counts, not modified/removed stats.

## 9. API contracts

All endpoints are in-app `POST`s (except Benefits GETs noted below). Production relies on owner-only perimeter access control.

### `POST /api/plaid/link-token`

- Request body: `{ itemId?: string }`. Omit `itemId` for new connections; pass an existing `itemId` for that Item’s update-mode (reconnect) Link token.
- Success: `{ linkToken: string }`.
- Failure: `{ error: string }` (404 when `itemId` is missing).

### `POST /api/plaid/exchange`

- Request: `{ publicToken, institutionId?, institutionName? }`.
- Behavior: exchange token, encrypt and store, fetch brand, first sync.
- Success: `{ connected: true, added: number }`.

### `POST /api/plaid/sync`

- Request body: none.
- Behavior: sync all connected Items.
- Success: `{ added: number, institutions: number }`.

### `POST /api/plaid/institutions/refresh`

- Request body: none.
- Behavior: re-fetch logo and primary color for all Items that have `institution_id`.
- Success: `{ updated: number }`.
- No UI button today; mainly for maintenance/backfill.

### `POST /api/accounts/reorder`

- Request: `{ accountIds: string[] }`.
- Validation: non-empty, all non-empty strings, no duplicates.
- Behavior: update `sort_order` by array position.
- Success: `{ saved: true }`.
- Server does not verify same-bank membership; the client enforces that.

### `POST /api/accounts/display-mask`

- Request: `{ accountId, displayMask: string | null }`.
- Amex path for saving/clearing user-entered last 5 digits; Success returns updated `displayMask`.

### `POST /api/transactions/note`

- Request: `{ transactionId, note: string | null }`.
- Save or clear transaction note.

### `POST /api/transactions/triage`

- Request: `{ transactionId, triage: "untriaged"|"recognized"|"questioned" }`.
- Update triage status.

### Benefits API (all behind Access)

| Method | Path | Role |
| --- | --- | --- |
| GET | `/api/benefits?year=` | Bundle: products/defs/assignments/periods (and ensure periods) |
| POST | `/api/benefits/products` | Create template (optional initial benefits) |
| PATCH/DELETE | `/api/benefits/products/:id` | Rename / delete template (cascade assignment+periods) |
| POST | `/api/benefits/products/:id/benefits` | Append one benefit def to a template |
| PATCH | `/api/benefits/defs/:id` | Update def (name/window); conflict with used period → 409 |
| POST/DELETE | `/api/benefits/assign` | Assign / unassign template to account |
| PATCH | `/api/benefits/periods` | Update period status (cell click) |

## 10. Migration workflow

After changing `db/schema.ts`:

1. Run `pnpm run db:generate`.
2. Inspect the new SQL; confirm only expected changes and no data loss.
3. Commit schema, migration SQL, and drizzle metadata together.
4. Run `pnpm run build`.
5. Apply to remote D1: `pnpm exec wrangler d1 migrations apply ledger --remote --config wrangler.toml` (or dashboard SQL).
6. Publish the Worker with `pnpm run deploy`.

Current migrations:

- `0000_many_deathstrike.sql`: create the three core tables.
- `0001_strong_hercules.sql`: add query indexes.
- `0002_cold_demogoblin.sql`: add account `sort_order`.
- `0003_wandering_betty_ross.sql`: add institution logo and primary color.
- `0004_broad_firebird.sql`: Benefits four tables (products/defs/assignments/periods).
- `0005_easy_iron_patriot.sql`: benefit_defs from/to period.
- `0006_hot_captain_america.sql`: accounts.display_mask.
- `0007_easy_pride.sql`: transactions.note.
- `0008_steep_yellowjacket.sql`: transactions.triage (default untriaged).
- `0009_omniscient_magus.sql`: indexes on transactions category_primary / category_detailed.
- `0010_secret_human_robot.sql`: index on transactions.triage.

Do not hand-edit migrations that have already shipped; generate a new migration for further schema changes.

## 11. Local development

Prerequisites: Node.js `>=22.13.0`, pnpm 11, valid local Plaid env vars.

```bash
pnpm install
pnpm run dev
```

Build:

```bash
pnpm run build
```

Note: local Vite config uses a placeholder D1 database ID; Cloudflare/dev tooling supplies the local binding. Opening a static page without usable D1 hits the `databasePending` fallback; real accounts and transactions will not appear.

`pnpm-workspace.yaml` explicitly allows install scripts for esbuild, sharp, unrs-resolver, and workerd; these are required by the current build chain—do not restore scaffold placeholder text.

## 12. Build and release

**Production release path is the self-managed Worker** (see section 19). Day-to-day: `pnpm run deploy` only.

```bash
pnpm run deploy   # vinext build && wrangler deploy --config wrangler.toml
```

Release principles:

1. Stay owner-only (Cloudflare Access Allow email list; widening requires user confirmation).
2. `pnpm run build` must succeed before release; schema changes: generate + remote-apply migration first.
3. **Always** pass `--config wrangler.toml` to avoid duplicate D1 bindings from Vite-merged `dist/server/wrangler.json`.
4. Do not commit `.env*`; do not echo secrets / access tokens / transaction data in replies.
5. DNS / Custom Domain cutovers require explicit user confirmation.

## 13. Security checklist

Every change must satisfy:

- Do not read and echo `.env.local` contents.
- Do not commit Plaid client secret, access tokens, bank credentials, full card numbers, cookies, or transaction exports.
- Do not return access tokens to the browser.
- Do not log Plaid request bodies or full error responses.
- Do not make browser localStorage the primary store instead of D1.
- Do not make the site public/shared unless the user explicitly requests it and app-layer auth + data isolation are designed.
- For new write APIs, remember security currently depends on Cloudflare Access at the edge + Worker JWT verification; expanding access requires server-side identity/ownership checks and data isolation.
- Do not put real account IDs, Item IDs, transactions, or balances in docs, screenshots, or test fixtures.
- Before deleting Items/accounts/transactions, clarify scope and prefer recoverable paths.

## 14. Verification suggestions

For ordinary UI changes, at least:

```bash
pnpm run build
```

For critical flows, manually verify:

- Accounts all collapsed by default; bank rows expand/collapse.
- Bank logos render when present; fallback works when absent.
- Account dialog opens and closes.
- Drag reorder only within the same bank group; order survives refresh.
- Cash includes only checking/savings; Credit balance only credit current balances.
- Transactions bank/account filters and prev/next page preserve params.
- At most 50 rows per page; date grouping order correct; triage/note work.
- Accounts Add bank / Sync / Reconnect work.
- Benefits matrix grouping, template edit, Assign, gesture-back without blank peek.
- Complete OAuth Plaid institution connect from `ledger.example.com`.
- Unauthorized visitors cannot reach pages or write APIs.

### Current test status

`pnpm test` is currently equivalent to a build smoke (`pnpm run build`). Old Sites-starter HTML tests were removed; real product tests still need to be added.

If a task involves tests, replace this rather than restoring the starter skeleton. Suggested layers:

1. Unit tests for balance summary and amount formatting pure functions.
2. Query-param, filter-priority, and pagination boundary tests.
3. Mocked `syncItem` tests for added/modified/removed/cursor.
4. Reorder API ID validation and D1 update tests.
5. Post-deploy minimal smoke for owner-only, Accounts, and Transactions.

## 15. Known limitations and tech debt

These are real limits today—do not treat them as finished features:

1. **Thin test coverage:** `pnpm test` is build smoke only; sync and balance-definition business tests are still missing.
2. **Balance currency rollup:** Cash and Credit balances currently merge all matching accounts as USD; no multi-currency grouping or FX.
3. **APIs do not re-auth per route:** rely on Cloudflare Access edge + `worker/index.ts` JWT defense (`x-ledger-owner-*`); redesign before widening access.
4. **No multi-user ownership:** core tables have no user ID; unsafe to widen access.
5. **No webhook / scheduled sync:** transactions update only on first connect or when the user taps Sync now.
6. **Weak reorder API validation:** server checks array shape only, not account set, institution membership, or omitted accounts.
7. **Group by institution name:** multiple Items for the same bank merge; different institutions with the same display name may also merge incorrectly.
8. **Serial sync:** all Items run in order; any Item throwing fails the whole `/api/plaid/sync`; no per-Item results or fault isolation.
9. **Incomplete Item status management:** each institution has a manual Reconnect button (Plaid update mode), but there is no automatic detection/display of `ITEM_LOGIN_REQUIRED` etc.—`status` is always `active`, and Reconnect is available for every Item alike (not evidence of a detected problem). No delete-Item entry point.
10. **Limited sync stats:** API/UI show added counts only, not modified/removed.
11. **OFFSET pagination** (50/page): fine for MVP; keyset/cursor pagination is more stable at very large volumes.
12. **Logos in D1:** base64 data URIs are simple but bulky; consider R2/cache if institutions grow; `r2` is currently null.
13. **Opaque error fallback:** `app/page.tsx` catches all D1 errors and only shows database pending; diagnostics are limited.
14. **OAuth host sensitivity:** production redirect URI uses the current Host; start connects from registered `ledger.example.com`.
15. **Unbranded favicon:** `public/favicon.svg` is still the scaffold blue pane; top bar has a green serif L brand-mark; formal icon awaits later design.

## 16. Common change entry points

| Need | Look first |
| --- | --- |
| Accounts UI | `app/transaction-dashboard.tsx`, `app/globals.css` |
| Balance definitions | `accountSummary` in `app/transaction-dashboard.tsx` |
| Transaction query/pagination | `app/page.tsx` (`PAGE_SIZE`, triage filter) |
| Transaction row UI / swipe / note | `app/transaction-dashboard.tsx`, `lib/triage.ts` |
| Benefits | `app/benefits-panel.tsx`, `lib/benefits*.ts`, `lib/card-art.ts` |
| Add filters | `app/page.tsx` query + dashboard filter UI |
| Plaid Link config | `app/api/plaid/link-token/route.ts` |
| First connect | `app/api/plaid/exchange/route.ts` |
| Sync semantics | `lib/sync.ts` — high risk; must cover added/modified/removed/cursor |
| Token encryption | `lib/plaid.ts` — high risk; consider old ciphertext compatibility and rotation |
| Data model | `db/schema.ts` + new migration |
| Account sort | `SortableAccountCard`, `reorderAccounts`, reorder API |
| Identity/access | `worker/index.ts` (sole check) + `lib/cloudflare-access.ts` + `app/access-auth.ts` |
| Deploy bindings | `wrangler.toml`, `worker-configuration.d.ts`, `vite.config.ts` (local placeholder binding) |

## 17. Suggested follow-on order

If the user has not set other priorities:

1. Replace the ineffective tests; cover sync and balance definitions first.
2. Add an explicit server-side owner authentication guard on every API.
3. Add Plaid webhooks or controlled scheduled sync, and record per-Item sync results.
4. Auto-detect and surface Item errors (`ITEM_LOGIN_REQUIRED`, etc.) plus disconnect management; manual reconnect (update mode) already exists.
5. Support suspicious-transaction flags, review state, and audit records.
6. If non-USD accounts appear, group by currency first, then consider FX and net worth.
7. After volume grows, migrate OFFSET pagination to stable keyset pagination.

## 18. Agent handoff template

After a substantial change, agents should state in the final reply (and docs if needed):

- What user-facing behavior changed.
- Which data/schema/APIs were touched.
- Which meaningful verifications ran; do not call known-broken starter tests “passing.”
- Whether a migration was generated, and the filename.
- Whether it was deployed, production URL, and access level.
- Open risks or decisions the user must make.

If code and this document disagree, prefer `AGENTS.md` safety rules and current source, and fix the docs in the same change.

## 19. Self-hosting

Greenfield install, human checkpoints (domain purchase, secrets, remote migrations, deploy approval), Access + Google, and Plaid setup are documented in **`DEPLOYMENT.md`**. Follow that file end-to-end; do not improvise production mutations from this technical note alone.

Invariants that must stay true:

- D1 binding name is `DB`.
- Access covers the entire custom hostname; Worker re-verifies `Cf-Access-Jwt-Assertion`.
- Owner emails live in Worker secret `ACCESS_ALLOWED_EMAILS`, not in git.
- Plaid secrets are Worker secrets; `PLAID_ENV` defaults to sandbox until Production is explicitly approved.
- Deploy with `pnpm run deploy` (`--config wrangler.toml`) to avoid duplicate D1 bindings from Vite merge output.

## 20. Product feature summary

High-level product/UX capabilities for handoff. Details live in source and sections 5–10.

### 20.1 Navigation and detail

- Standalone Settings tab removed; Add bank / Sync live on Accounts.
- Client tab switching (`goToTab` + history); server loads accounts + transactions + benefits once so tab switches need no network wait.
- Account / transaction / card-benefit detail / template edit: unified **fixed `.detail-panel` + underlayer list stays mounted + history gesture-back**.
- **Scroll root is `.app-scroll`** (window does not scroll), fixing iOS blank peek when opening detail mid-list then edge-swiping; see §5.1.
- Transaction detail: Triage / Note in the fields table; Note icon → in-place edit, save on blur; `visualViewport` keeps the keyboard from covering inputs.
- Top-right avatar menu shows Cloudflare Worker Version ID (`lib/deploy-version.ts` + `wrangler.toml` `version_metadata`).

### 20.2 Transactions

- `PAGE_SIZE` is **50**.
- List date filters: URL `year` / `month` (server filters `transactions.date` by range or `substr`).
- Added `transactions.note`, `transactions.triage` (migrations `0007`/`0008`) and APIs `/api/transactions/note|triage`.
- List: swipe triage, row tint, Triage filter slider; long-press row to edit note (selection/system Copy disabled); filter changes can patch locally without full-table refetch.

### 20.3 Accounts

- Static `institution-icons`, card-face `card-art` (`resolveCardArt`, including mask override).
- Amex `display_mask` (migration `0006` + `/api/accounts/display-mask`).
- Two-line bank row copy; Reconnect uses `Link2` icon; expand chevron removed.
- Balance summary includes Cash / Invest / Credit.

### 20.4 Benefits

- Migrations `0004`/`0005` four tables; `app/benefits-panel.tsx` + `lib/benefits*.ts`.
- UI collapsed to a single matrix (grouped by template); unassigned cards Assign at bottom; `+ Template` creates; Pencil opens single-template edit.
- Card order within a template = Accounts `sort_order`.
- Card-face thumbs used in matrix / list / detail.

### 20.5 Deploy and docs status

- Day-to-day release: `pnpm run deploy` to the `ledger` Worker; production hostname is configured by the deployer.
- `public/favicon.svg` is still the scaffold default; branded icon awaits later design (do not commit temporary concept art into the repo).

### 20.6 Key file index

| Area | Files |
| --- | --- |
| Server entry | `app/page.tsx` |
| Main UI | `app/transaction-dashboard.tsx`, `app/benefits-panel.tsx`, `app/globals.css` |
| Triage | `lib/triage.ts`, `app/api/transactions/triage/route.ts` |
| Notes | `app/api/transactions/note/route.ts` |
| Card art / bank icons | `lib/card-art.ts`, `lib/institution-icons.ts`, `public/card-art/`, `public/institution-icons/` |
| Benefits logic | `lib/benefits.ts`, `lib/benefits-shared.ts`, `lib/benefit-defs.ts`, `app/api/benefits/**` |
| Access | `worker/index.ts`, `lib/cloudflare-access.ts`, `app/access-auth.ts` |
| Deploy | `wrangler.toml`, `package.json#deploy` |
