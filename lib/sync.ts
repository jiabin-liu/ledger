import { env } from "cloudflare:workers";
import { applyCategoryRules } from "./category-rules";
import { decryptAccessToken, plaidRequest } from "./plaid";

type PlaidAccount = {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: { current: number | null; available: number | null; iso_currency_code: string | null };
};

type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  name: string;
  merchant_name: string | null;
  original_description?: string | null;
  amount: number;
  iso_currency_code: string | null;
  date: string;
  authorized_date: string | null;
  pending: boolean;
  personal_finance_category: { primary: string; detailed: string } | null;
  payment_channel: string | null;
  logo_url?: string | null;
  website?: string | null;
};

type SyncResponse = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  accounts: PlaidAccount[];
  next_cursor: string;
  has_more: boolean;
};

const now = () => new Date().toISOString();
const milliunits = (value: number | null) => value === null ? null : Math.round(value * 1000);

async function upsertAccounts(db: D1Database, itemId: string, accounts: PlaidAccount[]) {
  for (let start = 0; start < accounts.length; start += 80) {
    const statements = accounts.slice(start, start + 80).map((account) => db.prepare(`
      INSERT INTO accounts (
        account_id, item_id, name, official_name, mask, type, subtype,
        current_balance_milliunits, available_balance_milliunits, iso_currency_code, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        name = excluded.name,
        official_name = excluded.official_name,
        mask = excluded.mask,
        type = excluded.type,
        subtype = excluded.subtype,
        current_balance_milliunits = excluded.current_balance_milliunits,
        available_balance_milliunits = excluded.available_balance_milliunits,
        iso_currency_code = excluded.iso_currency_code,
        updated_at = excluded.updated_at
    `).bind(
      account.account_id,
      itemId,
      account.name,
      account.official_name,
      account.mask,
      account.type,
      account.subtype,
      milliunits(account.balances.current),
      milliunits(account.balances.available),
      account.balances.iso_currency_code,
      now(),
    ));
    if (statements.length) await db.batch(statements);
  }
}

async function upsertTransactions(db: D1Database, itemId: string, rows: PlaidTransaction[]) {
  for (let start = 0; start < rows.length; start += 80) {
    const statements = rows.slice(start, start + 80).map((row) => db.prepare(`
      INSERT INTO transactions (
        transaction_id, account_id, item_id, name, merchant_name, original_description,
        amount_milliunits, iso_currency_code, date, authorized_date, pending,
        category_primary, category_detailed, payment_channel, logo_url, website, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(transaction_id) DO UPDATE SET
        account_id = excluded.account_id,
        name = excluded.name,
        merchant_name = excluded.merchant_name,
        original_description = excluded.original_description,
        amount_milliunits = excluded.amount_milliunits,
        iso_currency_code = excluded.iso_currency_code,
        date = excluded.date,
        authorized_date = excluded.authorized_date,
        pending = excluded.pending,
        category_primary = excluded.category_primary,
        category_detailed = excluded.category_detailed,
        payment_channel = excluded.payment_channel,
        logo_url = excluded.logo_url,
        website = excluded.website,
        updated_at = excluded.updated_at
    `).bind(
      row.transaction_id,
      row.account_id,
      itemId,
      row.name,
      row.merchant_name,
      row.original_description ?? null,
      milliunits(row.amount),
      row.iso_currency_code,
      row.date,
      row.authorized_date,
      row.pending ? 1 : 0,
      row.personal_finance_category?.primary ?? null,
      row.personal_finance_category?.detailed ?? null,
      row.payment_channel,
      row.logo_url ?? null,
      row.website ?? null,
      now(),
    ));
    if (statements.length) await db.batch(statements);
  }
}

export async function syncItem(item: { itemId: string; accessTokenCiphertext: string; syncCursor: string | null }) {
  const db = env.DB;
  const accessToken = await decryptAccessToken(item.accessTokenCiphertext);
  let cursor = item.syncCursor ?? undefined;
  let hasMore = true;
  let addedCount = 0;
  const touchedTransactionIds: string[] = [];

  // `/transactions/sync` only reports accounts that have associated transactions in that
  // response, so an account with no transaction activity yet would never be persisted.
  // `/accounts/get` returns every open account on the Item regardless of transaction history.
  const accountsResponse = await plaidRequest<{ accounts: PlaidAccount[] }>("/accounts/get", {
    access_token: accessToken,
  });
  await upsertAccounts(db, item.itemId, accountsResponse.accounts);

  while (hasMore) {
    const response = await plaidRequest<SyncResponse>("/transactions/sync", {
      access_token: accessToken,
      ...(cursor ? { cursor } : {}),
      options: { include_original_description: true, personal_finance_category_version: "v2" },
    });

    await upsertAccounts(db, item.itemId, response.accounts);
    await upsertTransactions(db, item.itemId, [...response.added, ...response.modified]);
    for (const row of [...response.added, ...response.modified]) touchedTransactionIds.push(row.transaction_id);
    if (response.removed.length) {
      await db.batch(response.removed.map((row) =>
        db.prepare("DELETE FROM transactions WHERE transaction_id = ?").bind(row.transaction_id),
      ));
    }

    addedCount += response.added.length;
    cursor = response.next_cursor;
    hasMore = response.has_more;
  }

  await db.prepare(
    "UPDATE plaid_items SET sync_cursor = ?, status = 'active', updated_at = ? WHERE item_id = ?",
  ).bind(cursor ?? null, now(), item.itemId).run();

  if (touchedTransactionIds.length) await applyCategoryRules(touchedTransactionIds);

  return addedCount;
}
