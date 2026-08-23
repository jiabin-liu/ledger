#!/bin/bash
# Apply the current drizzle migrations to a remote Cloudflare D1 database via the HTTP API.
# Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment (never printed).
# Usage: apply_migrations_remote.sh <database_uuid>
#
# Statements are inlined (rather than parsed from drizzle/*.sql) to avoid
# portability issues with multi-character record separators in BSD awk.
# Keep this list in sync with drizzle/*.sql when new migrations are added.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <database_uuid>" >&2
  exit 2
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID in environment" >&2
  exit 2
fi

DB_UUID="$1"
ENDPOINT="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${DB_UUID}/query"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

STATEMENTS=(
'CREATE TABLE `accounts` (
	`account_id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`name` text NOT NULL,
	`official_name` text,
	`mask` text,
	`type` text NOT NULL,
	`subtype` text,
	`current_balance_milliunits` integer,
	`available_balance_milliunits` integer,
	`iso_currency_code` text,
	`updated_at` text NOT NULL
);'
'CREATE TABLE `plaid_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` text NOT NULL,
	`institution_id` text,
	`institution_name` text NOT NULL,
	`access_token_ciphertext` text NOT NULL,
	`sync_cursor` text,
	`status` text DEFAULT '"'"'active'"'"' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);'
'CREATE UNIQUE INDEX `plaid_items_item_id_unique` ON `plaid_items` (`item_id`);'
'CREATE TABLE `transactions` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`item_id` text NOT NULL,
	`name` text NOT NULL,
	`merchant_name` text,
	`original_description` text,
	`amount_milliunits` integer NOT NULL,
	`iso_currency_code` text,
	`date` text NOT NULL,
	`authorized_date` text,
	`pending` integer DEFAULT false NOT NULL,
	`category_primary` text,
	`category_detailed` text,
	`payment_channel` text,
	`logo_url` text,
	`website` text,
	`updated_at` text NOT NULL
);'
'CREATE INDEX `idx_accounts_item_id` ON `accounts` (`item_id`);'
'CREATE INDEX `idx_transactions_date` ON `transactions` (`date`);'
'CREATE INDEX `idx_transactions_account_id` ON `transactions` (`account_id`);'
'CREATE INDEX `idx_transactions_item_id` ON `transactions` (`item_id`);'
'ALTER TABLE `accounts` ADD `sort_order` integer DEFAULT 0 NOT NULL;'
'ALTER TABLE `plaid_items` ADD `institution_logo` text;'
'ALTER TABLE `plaid_items` ADD `institution_primary_color` text;'
)

idx=0
for stmt in "${STATEMENTS[@]}"; do
  idx=$((idx + 1))
  payload_file="$WORKDIR/payload_${idx}.json"
  jq -n --arg sql "$stmt" '{sql: $sql}' > "$payload_file"

  resp_file="$WORKDIR/resp_${idx}.json"
  status=$(curl -s -o "$resp_file" -w "%{http_code}" \
    -X POST "$ENDPOINT" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary "@${payload_file}")

  success=$(jq -r '.success' "$resp_file")
  if [ "$success" != "true" ]; then
    echo "[$idx] FAILED (HTTP $status):"
    jq '.errors' "$resp_file"
    exit 1
  fi
  echo "[$idx] OK (HTTP $status)"
done

echo "All ${idx} statements applied successfully."
