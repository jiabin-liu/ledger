import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const plaidItems = sqliteTable("plaid_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: text("item_id").notNull().unique(),
  institutionId: text("institution_id"),
  institutionName: text("institution_name").notNull(),
  institutionLogo: text("institution_logo"),
  institutionPrimaryColor: text("institution_primary_color"),
  accessTokenCiphertext: text("access_token_ciphertext").notNull(),
  syncCursor: text("sync_cursor"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const accounts = sqliteTable("accounts", {
  accountId: text("account_id").primaryKey(),
  itemId: text("item_id").notNull(),
  name: text("name").notNull(),
  officialName: text("official_name"),
  mask: text("mask"),
  displayMask: text("display_mask"),
  type: text("type").notNull(),
  subtype: text("subtype"),
  currentBalanceMilliunits: integer("current_balance_milliunits"),
  availableBalanceMilliunits: integer("available_balance_milliunits"),
  isoCurrencyCode: text("iso_currency_code"),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_accounts_item_id").on(table.itemId)]);

export const transactions = sqliteTable("transactions", {
  transactionId: text("transaction_id").primaryKey(),
  accountId: text("account_id").notNull(),
  itemId: text("item_id").notNull(),
  name: text("name").notNull(),
  merchantName: text("merchant_name"),
  originalDescription: text("original_description"),
  amountMilliunits: integer("amount_milliunits").notNull(),
  isoCurrencyCode: text("iso_currency_code"),
  date: text("date").notNull(),
  authorizedDate: text("authorized_date"),
  pending: integer("pending", { mode: "boolean" }).notNull().default(false),
  categoryPrimary: text("category_primary"),
  categoryDetailed: text("category_detailed"),
  paymentChannel: text("payment_channel"),
  logoUrl: text("logo_url"),
  website: text("website"),
  note: text("note"),
  triage: text("triage").notNull().default("untriaged"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_transactions_date").on(table.date),
  index("idx_transactions_account_id").on(table.accountId),
  index("idx_transactions_item_id").on(table.itemId),
  index("idx_transactions_category_primary").on(table.categoryPrimary),
  index("idx_transactions_category_detailed").on(table.categoryDetailed),
  index("idx_transactions_triage").on(table.triage),
]);

/** Credit-card benefit templates (new tables only; never mutate Plaid tables). */
export const cardProducts = sqliteTable("card_products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const benefitDefs = sqliteTable("benefit_defs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull(),
  name: text("name").notNull(),
  amountMilliunits: integer("amount_milliunits").notNull(),
  cadence: text("cadence").notNull(),
  effectiveFromYear: integer("effective_from_year"),
  effectiveFromPeriod: text("effective_from_period"),
  effectiveToYear: integer("effective_to_year"),
  effectiveToPeriod: text("effective_to_period"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_benefit_defs_product_id").on(table.productId)]);

export const benefitAssignments = sqliteTable("benefit_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id").notNull(),
  productId: integer("product_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_benefit_assignments_account_id").on(table.accountId),
  index("idx_benefit_assignments_product_id").on(table.productId),
]);

export const benefitPeriods = sqliteTable("benefit_periods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id").notNull(),
  benefitDefId: integer("benefit_def_id").notNull(),
  year: integer("year").notNull(),
  periodKey: text("period_key").notNull(),
  status: text("status").notNull().default("available"),
  note: text("note"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_benefit_periods_unique").on(table.accountId, table.benefitDefId, table.year, table.periodKey),
  index("idx_benefit_periods_account_year").on(table.accountId, table.year),
  index("idx_benefit_periods_benefit_def_id").on(table.benefitDefId),
]);
