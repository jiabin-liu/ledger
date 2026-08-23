# Ledger Cloudflare Deployment Guide

This document is the deployment contract for a clean Ledger installation. A human or coding agent should be able to follow it without access to any private fork or production account.

## 1. What this deployment creates

The finished installation consists of:

1. One Cloudflare Worker (`ledger`) serving the UI and application API.
2. One Cloudflare D1 database bound to the Worker as `DB`.
3. One custom hostname, such as `ledger.example.com`.
4. One Cloudflare Access self-hosted application protecting the entire hostname.
5. One Google OAuth web client used by Cloudflare Access.
6. One Access Allow policy restricted to the owner's exact email address(es).
7. One Plaid application (Sandbox first; Production when the human is ready) whose OAuth redirect URI matches the custom hostname.

Google authentication is terminated by Cloudflare Access. Ledger does not receive Google access tokens and does not call Gmail APIs. The Worker verifies Cloudflare's `Cf-Access-Jwt-Assertion`, then enforces `ACCESS_ALLOWED_EMAILS`.

Bank credentials are entered only inside Plaid Link. Ledger stores encrypted Plaid access tokens in D1 and never returns them to the browser.

Useful official references:

- [Cloudflare D1: create and bind a database](https://developers.cloudflare.com/d1/get-started/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Wrangler configuration and Custom Domains](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Access Google identity provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)
- [Cloudflare Access self-hosted public application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Cloudflare Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Plaid Link](https://plaid.com/docs/link/)
- [Plaid `/transactions/sync`](https://plaid.com/docs/api/products/transactions/#transactionssync)
- [Plaid OAuth redirect URIs](https://plaid.com/docs/link/oauth/)

## 2. Security properties that must remain true

Do not weaken these invariants during deployment:

- The custom hostname is covered in full by a Cloudflare Access application (root and all paths, including `/api/*` and static assets).
- The Access Allow policy includes the owner's **exact email**, not `Everyone`, all valid emails, or an unrestricted email domain.
- Google (or another deliberately configured IdP) is the selected login method.
- `ACCESS_ALLOWED_EMAILS` (Worker secret) matches the Access policy email(s), comma-separated, lowercased comparison.
- `ACCESS_TEAM_DOMAIN` is the full team URL (`https://<team>.cloudflareaccess.com`) with no trailing slash mismatch versus JWT issuer.
- `ACCESS_POLICY_AUD` is the AUD of the Access application that protects this hostname.
- The D1 binding remains named `DB`.
- `workers_dev` remains `false` in production `wrangler.toml` so the app is not reachable on an unprotected `*.workers.dev` URL.
- Plaid Client Secret, Cloudflare tokens, Google OAuth Client Secret, Access cookies, and bank passwords are never committed, logged, or pasted into chat.
- Do not add a Bypass Access policy for the API.
- Do not trust client-supplied `x-ledger-owner-*` headers; the Worker overwrites them after JWT verification.
- Do not put real card last-4 values into `lib/card-art.ts` mask overrides in a public fork.

Cloudflare Access denies users by default unless they match an Allow policy. Avoid an `Include Everyone` policy.

## 3. Prerequisites

The deployer needs:

- Node.js `22.13.0` or newer.
- pnpm (Corepack is acceptable).
- A Cloudflare account with permission to create Workers, D1, Custom Domains, Images usage as required by the Worker, and Zero Trust Access resources.
- A registered domain in an active Cloudflare DNS zone (see §3.2).
- A Google account that will own the OAuth client and sign in to the app.
- A Plaid account (Sandbox is enough to validate the install; Production requires Plaid approval and human confirmation).

### 3.1 Agent execution protocol and human checkpoints

This guide is designed for an agent-assisted deployment, but several steps require a human because they involve payment, account ownership, secrets, interactive authentication, bank OAuth, or an irreversible production change.

An agent following this guide must:

1. Read this entire guide before changing local or remote state.
2. Ask the human for the deployment values in §4; never infer an email, domain, account, or preferred hostname from unrelated context.
3. Stop at every **HUMAN ACTION REQUIRED** / **HUMAN APPROVAL REQUIRED** checkpoint and explain exactly what the human must do, what value or confirmation is needed, and how to verify completion.
4. Never ask the human to paste a Plaid Client Secret, Google OAuth Client Secret, Cloudflare API token, password, session cookie, payment information, bank login, or domain-contact information into chat or a tracked file.
5. Never purchase or transfer a domain, accept a price, create a billable resource, apply a remote migration, deploy to production, change an Access policy, or switch Plaid to Production without explicit authorization for that action.
6. Resume only after the human confirms the checkpoint is complete. Recheck observable state when CLI or dashboard access makes that possible.
7. Report exact verification results at the end; do not treat a successful build as a successful deployment.

Before starting, the agent must ask the human to confirm all of the following:

- a Cloudflare account exists, its email is verified, and the human can complete interactive login;
- the intended Cloudflare account can use Workers, D1, DNS, Images (as needed), and Zero Trust;
- a Google account exists and can create or own the OAuth configuration;
- either a suitable domain is already active in Cloudflare or the human is willing to purchase/connect one;
- the exact email address that should be the only allowed owner (or an explicit short allow-list);
- a Plaid account exists (or the human will create one);
- the human understands that domain registration and some Cloudflare/Plaid plans may cost money, and that production mutations require separate approvals later.

If any answer is unknown, the agent must explain and resolve that prerequisite before creating resources.

Responsibility summary:

| Task | Agent can prepare/verify | Human must do or explicitly approve |
| --- | --- | --- |
| Choose domain and hostname | Explain options and validate formatting | Choose the name; approve any purchase or transfer and price |
| Domain registration/contact | Link to the correct dashboard and verify zone status afterward | Enter contact/payment data, accept registrar terms, verify registrant email |
| Wrangler authentication | Run `wrangler whoami` after login | Complete interactive browser login and grant Cloudflare access |
| D1 creation | Run the command after authorization and record the non-secret database ID in config | Explicitly approve creation in the intended Cloudflare account |
| Google OAuth | Provide exact origins, redirect URI, scopes, and validation steps | Sign in to Google, create/select the project and OAuth client, handle the Client Secret |
| Cloudflare Access | Explain the application and exact-email policy; verify behavior | Paste the Google Client Secret into Cloudflare and confirm the policy/account choices |
| Plaid credentials | Explain Sandbox vs Production and redirect URI rules | Create/select the Plaid app; copy Client ID/Secret privately; approve Production when ready |
| Worker secrets | Run `wrangler secret put` after approval, without echoing values | Provide secrets via secure local input; never paste into chat |
| Remote migrations | Inspect SQL, run local validation, and show the planned target | Explicitly approve applying migrations to the named remote D1 database |
| Production deploy | Build, show target Worker/domain, and deploy after approval | Explicitly approve the production deployment |
| First login + bank link | Check public HTTP behavior and Access redirects | Complete Google login and Plaid Link / bank OAuth in the browser |

### 3.2 Acquire or connect a domain

Ledger requires a custom hostname such as `ledger.example.com`. The deployer must own the parent domain and the domain must be active in the same Cloudflare account that will host the Worker.

#### Option A: the human does not own a domain yet

**STOP — HUMAN ACTION REQUIRED**

The human must purchase a domain before deployment can continue. Domain registration is a paid, contractual action and must not be performed by an agent without the human reviewing the exact domain, current registration and renewal price, registrant details, auto-renew behavior, and terms.

Recommended dashboard workflow:

1. Verify the Cloudflare account email.
2. In Cloudflare Dashboard, open **Domain Registration → Register Domains**.
3. Search for the exact desired domain and review availability and price.
4. Enter accurate registrant contact and payment information privately in the Cloudflare dashboard.
5. Review the registration term, renewal behavior, and agreements, then complete the purchase.
6. Complete registrant-email verification if requested.
7. Confirm the domain appears as active in Cloudflare.

Official instructions: [Register a new domain with Cloudflare Registrar](https://developers.cloudflare.com/registrar/get-started/register-domain/).

The human should tell the agent only:

- the registered domain name;
- the chosen application hostname, such as `ledger.example.com`;
- confirmation that the zone is active.

Payment details and registrant contact information are not needed by the application or agent.

#### Option B: the human already owns a domain

If the domain is already managed by Cloudflare and its zone status is **Active**, choose an unused hostname and continue.

If the domain is registered elsewhere and is not yet active in Cloudflare, the human must add the domain to Cloudflare and update the authoritative nameservers at the current registrar. Wait until Cloudflare reports the zone as **Active** before deploying. The domain does not have to be transferred to Cloudflare Registrar; it only needs an active Cloudflare DNS zone.

Official overview: [Manage domains with Cloudflare](https://developers.cloudflare.com/fundamentals/manage-domains/).

**Checkpoint confirmation:** The agent must obtain and restate the final `APP_DOMAIN` and confirm that the parent zone is active before creating production resources.

### 3.3 Prepare the local environment and authenticate Wrangler

```bash
node --version   # expect >= 22.13.0
pnpm --version
pnpm install
```

**STOP — HUMAN ACTION REQUIRED**

The human must confirm which Cloudflare account should receive the deployment. Start interactive Wrangler authentication, let the human complete the browser login privately, then confirm identity:

```bash
pnpm exec wrangler login
pnpm exec wrangler whoami
```

Do not create or paste a broad Cloudflare API token into source files for a one-owner setup.

## 4. Choose deployment values

Decide these values before editing files:

| Name | Example | Rules |
| --- | --- | --- |
| `APP_DOMAIN` | `ledger.example.com` | Inside an active Cloudflare-managed zone. |
| `OWNER_EMAIL` | `owner@gmail.com` | Exact Google account allowed to sign in (or first of an explicit allow-list). |
| `D1_DATABASE_NAME` | `ledger` | Keep `ledger` if following this guide and package scripts. |
| `WORKER_NAME` | `ledger` | Must be unique enough within the Cloudflare account. |
| `ACCESS_TEAM_NAME` | `my-team` | Produces `https://my-team.cloudflareaccess.com`. |
| `PLAID_ENV` | `sandbox` | Use `sandbox` until the human explicitly approves Production. |

These are configuration values, not secrets. Plaid Client Secret and Google Client Secret are secrets and are not listed here.

## 5. Create the D1 database

**STOP — HUMAN APPROVAL REQUIRED**

Before running the command, the agent must state the authenticated Cloudflare account, proposed database name, and that this creates a remote resource. Continue only after the human approves that target.

```bash
pnpm exec wrangler d1 create ledger
```

Save the printed UUID as `D1_DATABASE_ID`. Prefer answering `No` if Wrangler offers to auto-edit config, then edit `wrangler.toml` manually so the binding stays `DB`.

Open `wrangler.toml` and replace placeholders:

- `account_id` (if required for your Wrangler setup)
- `[[routes]].pattern` → `APP_DOMAIN`
- `[[d1_databases]].database_id` → `D1_DATABASE_ID`
- `[[d1_databases]].database_name` → `ledger` (or the name you created)
- `ACCESS_TEAM_DOMAIN` → `https://<ACCESS_TEAM_NAME>.cloudflareaccess.com` (fill after §7)
- `ACCESS_POLICY_AUD` → Access application AUD (fill after §10)
- Keep `PLAID_ENV = "sandbox"` until Production is approved
- Keep `workers_dev = false`
- Keep Images binding `IMAGES` and assets binding `ASSETS`

Do not change the D1 binding name from `DB`.

## 6. Apply migrations

First validate against a local D1 database:

```bash
pnpm exec wrangler d1 migrations apply ledger --local --config wrangler.toml
```

Inspect every pending SQL file under `drizzle/` and summarize tables and destructive statements.

**STOP — HUMAN APPROVAL REQUIRED**

Show the exact remote D1 database name and pending migration list. Apply remote migrations only after explicit approval:

```bash
pnpm exec wrangler d1 migrations apply ledger --remote --config wrangler.toml
```

Verify empty core tables on a clean install:

```bash
pnpm exec wrangler d1 execute ledger --remote --config wrangler.toml --command \
  "SELECT (SELECT COUNT(*) FROM plaid_items) AS items, (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM transactions) AS transactions;"
```

Expected for a clean installation: all counts are `0`.

## 7. Set up a Cloudflare Zero Trust team

**STOP — HUMAN ACTION REQUIRED**

The human must complete any first-time Zero Trust onboarding, review plan selection, and choose the team name. The agent must not select a paid plan or accept organization terms on the human's behalf.

1. Open **Zero Trust** in the Cloudflare Dashboard.
2. Complete onboarding if needed.
3. Choose an Access team name.
4. Record the team domain, for example:

```text
https://my-team.cloudflareaccess.com
```

Put that exact value into `wrangler.toml` as `ACCESS_TEAM_DOMAIN` (no trailing path).

## 8. Create the Google OAuth application

Follow Cloudflare's [official Google identity-provider guide](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/).

**STOP — HUMAN ACTION REQUIRED**

The human must sign in to Google Cloud Console and own the project and OAuth client. The agent may provide field values but must not handle the Client Secret in chat.

### 8.1 Project and consent screen

1. Create or select a Google Cloud project dedicated to auth.
2. Configure the OAuth consent screen:
   - App name: `Ledger` (or the fork name)
   - Audience: **External** for a normal consumer Gmail account
   - Support/contact email: the owner email
   - Scopes: only basic identity (`openid`, profile, email). Do **not** add Gmail, Drive, or Calendar scopes.
3. If the app remains in **Testing**, add the owner email as a test user.

### 8.2 OAuth client

Create a **Web application** client.

Authorized JavaScript origin:

```text
https://my-team.cloudflareaccess.com
```

Authorized redirect URI:

```text
https://my-team.cloudflareaccess.com/cdn-cgi/access/callback
```

The redirect URI must match exactly. Do **not** use the Ledger application domain as the Google redirect URI; Google redirects back to Cloudflare Access.

Keep the Client Secret in a password manager. Do not commit `client_secret.json`.

**Checkpoint confirmation:** The human confirms the OAuth client exists and that the Client ID/Secret are available privately. The secret itself must not be sent to the agent.

## 9. Add Google as the Cloudflare Access identity provider

**STOP — HUMAN ACTION REQUIRED**

Paste the Google Client Secret directly into the Cloudflare dashboard from a password manager. Do not place it in a terminal command, repository file, screenshot, issue, or chat message.

1. **Zero Trust → Integrations → Identity providers**
2. Add **Google**
3. Paste Client ID and Client Secret
4. Save and use Cloudflare's **Test** action
5. Confirm Google returns the exact intended owner email

## 10. Create the Access application and exact-email policy

**STOP — HUMAN CONFIRMATION REQUIRED**

Before saving, the human must review the hostname, exact allowed email, selected Google identity provider, policy action, and session duration. This policy controls who can see bank and transaction data.

1. **Zero Trust → Access controls → Applications → Create**
2. Choose **Self-hosted**
3. Public hostname = `APP_DOMAIN` (example `ledger.example.com`)
4. Cover the root and all paths. Do not add public path exceptions for `/api/*`.
5. Add an Allow policy:
   - Include selector: **Emails**
   - Value: exact `OWNER_EMAIL` (add additional exact emails only if the human explicitly wants a short allow-list)
6. Prefer requiring the Google IdP created above
7. Choose a session duration and save

Do **not** configure:

- `Include Everyone`
- unrestricted `Emails ending in @…`
- a `Bypass` policy for the app hostname
- One-time PIN as an unrestricted Include rule

### 10.1 Record the Access Application AUD

In the Access application settings, copy the Application Audience (AUD) tag and set:

```toml
ACCESS_POLICY_AUD = "<paste-aud-here>"
```

in `wrangler.toml` `[vars]`. Redeploy is required after this change.

## 11. Configure Plaid

**STOP — HUMAN ACTION REQUIRED**

1. Sign in to the [Plaid Dashboard](https://dashboard.plaid.com/).
2. Create or select an application.
3. Copy **client_id** and the **sandbox** secret into a password manager (not chat).
4. For Sandbox validation, no Production OAuth redirect is required yet.
5. When the human later approves Production:
   - Switch the Plaid app to Production (may require Plaid approval / billing).
   - Add redirect URI exactly: `https://<APP_DOMAIN>/` (trailing slash as required by your Plaid settings and this app's Host-based redirect construction).
   - Set `PLAID_ENV = "production"` in `wrangler.toml` and put the Production secret via `wrangler secret put`.

## 12. Set Worker secrets

**STOP — HUMAN APPROVAL REQUIRED**

The agent may run these commands only after the human is ready to paste values into the local secure prompt (not into chat):

```bash
pnpm exec wrangler secret put PLAID_CLIENT_ID --config wrangler.toml
pnpm exec wrangler secret put PLAID_SECRET --config wrangler.toml
pnpm exec wrangler secret put ACCESS_ALLOWED_EMAILS --config wrangler.toml
```

`ACCESS_ALLOWED_EMAILS` should be a comma-separated list of exact emails, for example:

```text
owner@gmail.com
```

Do not print secret values in logs or commit them to `.env*` files that will be published.

Optional local file for `pnpm run dev` only:

```bash
cp .env.local.example .env.local
# fill PLAID_* privately
```

`.env.local` is gitignored.

## 13. Build and deploy

```bash
pnpm run test
pnpm run lint
```

The agent must report results and show the final Worker name, custom hostname, D1 database name/ID, Access AUD presence, and `PLAID_ENV`.

**STOP — HUMAN APPROVAL REQUIRED**

Deploy only after the human explicitly approves this production target:

```bash
pnpm run deploy
```

Always use the package script (or `wrangler deploy --config wrangler.toml`) so the root config wins over any Vite-merged `dist/server/wrangler.json`.

Record the Worker version ID from Wrangler output. Do not record credentials.

Cloudflare Custom Domains create the DNS record and certificate for a hostname in an active zone. Wait for certificate provisioning if the first requests fail briefly.

## 14. Production verification

### 14.1 Access gate

From a signed-out terminal:

```bash
curl -sS -o /dev/null -D - https://ledger.example.com/
```

Expected: HTTP redirect (normally `302`) to a Cloudflare Access login URL.

Forged identity headers must not bypass Access:

```bash
curl -sS -o /dev/null -D - \
  -H 'cf-access-authenticated-user-email: owner@gmail.com' \
  -H 'x-ledger-owner-email: owner@gmail.com' \
  https://ledger.example.com/api/plaid/sync
```

Expected: Access login redirect or Worker `403`, never a successful sync.

### 14.2 Google login

**STOP — HUMAN ACTION REQUIRED**

1. Open `https://<APP_DOMAIN>/` in a private browser window.
2. Sign in with Google using the exact owner account.
3. Confirm the Ledger UI loads (Accounts / Transactions / Benefits).
4. Sign out or try another Google account and confirm it is denied.

### 14.3 Plaid Link (Sandbox)

**STOP — HUMAN ACTION REQUIRED**

1. In Accounts, use **Add bank**.
2. Complete Plaid Link with Sandbox credentials.
3. Confirm accounts appear and Sync imports transactions.
4. Optional D1 check (counts should now be non-zero):

```bash
pnpm exec wrangler d1 execute ledger --remote --config wrangler.toml --command \
  "SELECT COUNT(*) AS items FROM plaid_items;"
```

### 14.4 Owner-only API sanity

While signed in as owner, Sync should succeed. While signed out, `/api/plaid/sync` must not succeed.

### 14.5 UI smoke

- Transactions filters (year/month/bank/account/category/triage) load without error.
- Opening a transaction detail and using browser back / iOS edge-swipe returns to the list without a blank underlayer (see `technical.md` §5.1).
- Avatar menu shows a Cloudflare Worker version ID after deploy (hard refresh if needed).

## 15. Local development

```bash
pnpm install
cp .env.local.example .env.local
pnpm exec wrangler d1 migrations apply ledger --local --config wrangler.toml
pnpm run dev
```

Local auth still depends on the Worker Access check. Prefer validating on a real Access-protected hostname for end-to-end flows. Do not commit `.env.local`.

## 16. API surface (owner session required)

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/plaid/link-token` | Create Link token (optional `itemId` for update mode). |
| `POST` | `/api/plaid/exchange` | Exchange public token; encrypt access token; first sync. |
| `POST` | `/api/plaid/sync` | Sync all Items. |
| `POST` | `/api/plaid/institutions/refresh` | Refresh institution branding fields. |
| `POST` | `/api/accounts/reorder` | Persist account sort order. |
| `POST` | `/api/accounts/display-mask` | Optional Amex display mask. |
| `POST` | `/api/transactions/note` | Save transaction note. |
| `POST` | `/api/transactions/triage` | Save triage status. |
| `GET`/`POST`/… | `/api/benefits/*` | Benefit templates, assignments, periods. |

There is no public CLI API and no service-token read path in this open-source edition.

## 17. Updating schema and deploying future versions

```bash
pnpm run db:generate
# review drizzle/*.sql
pnpm exec wrangler d1 migrations apply ledger --local --config wrangler.toml
pnpm run test
# HUMAN APPROVAL for remote migration + deploy
pnpm exec wrangler d1 migrations apply ledger --remote --config wrangler.toml
pnpm run deploy
```

Apply remote migrations before deploying code that requires new columns. Never apply an unreviewed destructive migration.

## 18. Backup and rollback guidance

Before risky schema or data operations, use Cloudflare D1 backup/export facilities appropriate to the account plan. Record the current Worker version ID.

Worker rollback does not roll back D1 schema changes. Prefer a reviewed forward migration or restore from backup. Never run destructive SQL against a database selected through an unresolved shell variable.

Rotating `PLAID_SECRET` breaks decryption of existing `access_token_ciphertext` rows. Plan re-encryption or have the human reconnect banks after a secret rotation.

## 19. Troubleshooting

### Google `redirect_uri_mismatch`

Authorized redirect URI must be exactly:

```text
https://YOUR_TEAM_NAME.cloudflareaccess.com/cdn-cgi/access/callback
```

### Google user denied after successful login

Check exact email match across:

1. Google account email
2. Access policy Include Email value
3. Worker secret `ACCESS_ALLOWED_EMAILS`

Also verify Testing-mode test users if applicable.

### UI loads but APIs return `403`

- Access application covers the full hostname
- `ACCESS_TEAM_DOMAIN` / `ACCESS_POLICY_AUD` match the protecting application
- Secrets were set on the same Worker name that was deployed
- Worker was redeployed after config/secret changes
- `workers_dev` is not being used as a backdoor

### `D1 binding DB is unavailable`

Confirm binding name `DB`, real database UUID, and that deploy used `--config wrangler.toml`.

### Plaid Link fails / OAuth institution fails

- Redirect URI registered in Plaid matches `https://<APP_DOMAIN>/`
- `PLAID_ENV` matches the secret environment (sandbox vs production)
- Request Host is the Access-protected custom domain

### iOS back-gesture shows a blank list

Do not reintroduce `window` scrolling. Keep the `.app-scroll` layout described in `technical.md` §5.1. Do not `replaceState` immediately before detail `pushState`.

## 20. Final agent handoff checklist

An agent should not declare deployment complete until all boxes are true:

- [ ] Human chose the registered domain and application hostname.
- [ ] Domain registration/contact/payment steps were completed privately by the human where required.
- [ ] Registrant email is verified and the Cloudflare zone status is Active.
- [ ] `wrangler whoami` matches the Cloudflare account confirmed by the human.
- [ ] Human explicitly approved D1 creation, remote migrations, secret writes, and production deployment.
- [ ] `wrangler.toml` contains no leftover example hostname/AUD/team domain unless still intentionally unfinished (should be real values before go-live).
- [ ] D1 binding is exactly `DB`.
- [ ] Remote migrations applied successfully; clean install started with zero Items/accounts/transactions.
- [ ] Google OAuth redirect uses the Cloudflare Access team callback.
- [ ] Google Client Secret exists only in Cloudflare IdP configuration / password manager.
- [ ] Access application covers the full app hostname.
- [ ] Allow policy contains only the exact owner email(s) the human approved.
- [ ] No Guest or Bypass policy exists for the app hostname.
- [ ] `workers_dev` is `false`.
- [ ] `ACCESS_ALLOWED_EMAILS`, `PLAID_CLIENT_ID`, and `PLAID_SECRET` are set as Worker secrets.
- [ ] `PLAID_ENV` is still `sandbox` unless the human explicitly approved Production.
- [ ] Build/test/lint results reported.
- [ ] Deployment printed a successful Worker version ID.
- [ ] Signed-out request redirects to Cloudflare Access.
- [ ] Forged owner headers do not expose APIs.
- [ ] Owner Google login succeeds; another account is denied.
- [ ] Sandbox Plaid Link connects and sync imports data.

Once these checks pass, the deployment is complete.
