# Agent instructions

- Read `README.md` and `technical.md` before modifying the project.
- Read `DEPLOYMENT.md` completely before configuring or deploying.
- Never commit credentials, Plaid secrets, Cloudflare tokens, Access cookies, passwords, card last-4 overrides with real numbers, transaction exports, or private deployment data.
- Keep checked-in deployment configuration sanitized and use example values rather than a deployer's real domain, email, resource IDs, or account details.
- Update relevant documentation when behavior changes.
- Run `pnpm test` and `pnpm lint` before declaring implementation complete when those scripts are available and relevant.
- Review generated database migrations before applying them.
- Do not purchase domains, create billable resources, apply remote migrations, deploy, mutate Access policies, or change Plaid production settings unless the human explicitly authorizes that specific action.
- Never ask the human to paste Plaid Client Secret, Cloudflare API tokens, Google OAuth Client Secret, Access session cookies, bank login credentials, or payment details into chat or tracked files.
