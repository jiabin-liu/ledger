import { and, eq, inArray, or, like } from "drizzle-orm";
import { getDb } from "../db";
import { categoryRules, transactions } from "../db/schema";
import { isPlaidPrimaryCategory } from "./categories";

const now = () => new Date().toISOString();

export async function listCategoryRules() {
  return getDb().select().from(categoryRules).orderBy(categoryRules.id);
}

export async function createCategoryRule(pattern: string, categoryPrimary: string) {
  const trimmed = pattern.trim();
  if (trimmed.length < 3) throw new Error("Pattern must be at least 3 characters.");
  if (!isPlaidPrimaryCategory(categoryPrimary)) throw new Error("categoryPrimary is not a recognized category.");

  const db = getDb();
  const timestamp = now();
  const inserted = await db.insert(categoryRules).values({
    pattern: trimmed,
    categoryPrimary,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).returning();
  const rule = inserted[0];

  const updated = await applyCategoryRule(rule);
  return { rule, updated };
}

export async function deleteCategoryRule(id: number) {
  const db = getDb();
  await db.delete(categoryRules).where(eq(categoryRules.id, id));
}

/** Matches a rule's pattern (case-insensitive substring, per SQLite's default ASCII LIKE
 * behavior) against name, merchant name, or the raw Plaid description. */
function ruleMatchFilter(pattern: string) {
  const needle = `%${pattern}%`;
  return or(
    like(transactions.name, needle),
    like(transactions.merchantName, needle),
    like(transactions.originalDescription, needle),
  );
}

async function applyCategoryRule(rule: { pattern: string; categoryPrimary: string }, transactionIds?: string[]) {
  const db = getDb();
  const matchFilter = ruleMatchFilter(rule.pattern);
  const where = transactionIds ? and(matchFilter, inArray(transactions.transactionId, transactionIds)) : matchFilter;
  const result = await db
    .update(transactions)
    .set({ categoryPrimary: rule.categoryPrimary, categoryDetailed: null, updatedAt: now() })
    .where(where)
    .returning({ transactionId: transactions.transactionId });
  return result.length;
}

/** Applies every saved rule to transactions, so both a fresh Plaid sync and a manual
 * "reapply rules" backfill go through the same path. Rules run in creation order, so a
 * later rule can override an earlier, broader one for the same transaction. Scope to
 * `transactionIds` to limit the work to the rows a sync just touched. */
export async function applyCategoryRules(transactionIds?: string[]) {
  if (transactionIds && transactionIds.length === 0) return 0;
  const rules = await listCategoryRules();
  let updated = 0;
  for (const rule of rules) updated += await applyCategoryRule(rule, transactionIds);
  return updated;
}
