import { and, gte, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { transactions } from "../db/schema";

export type InsightsMode = "month" | "year" | "last12";

export type CategorySpending = {
  category: string | null;
  amountMilliunits: number;
};

export type SpendingSummary = {
  mode: InsightsMode;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  totalSpendingMilliunits: number;
  totalIncomeMilliunits: number;
  byCategory: CategorySpending[];
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function monthRange(year: number, month: number) {
  const start = `${year}-${pad2(month)}-01`;
  const end = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;
  return { start, end };
}

function yearRange(year: number) {
  return { start: `${year}-01-01`, end: `${year + 1}-01-01` };
}

/** Trailing 12 calendar months ending with (and including) the current, possibly partial, month. */
function last12MonthsRange(referenceDate = new Date()) {
  const y = referenceDate.getUTCFullYear();
  const m = referenceDate.getUTCMonth();
  const startDate = new Date(Date.UTC(y, m - 11, 1));
  const endDate = new Date(Date.UTC(y, m + 1, 1));
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return { start: fmt(startDate), end: fmt(endDate) };
}

export function resolveInsightsRange(mode: InsightsMode, year: number, month: number) {
  if (mode === "month") return monthRange(year, month);
  if (mode === "year") return yearRange(year);
  return last12MonthsRange();
}

/** Excluded from spending: internal transfers (paying your own credit card) and real income
 * (a paycheck shouldn't reduce a "spending" total just because it's a negative amount). */
const SPENDING_EXCLUDED_CATEGORIES = ["CREDIT_CARD_PAYMENT", "INCOME", "INVESTMENT"];
/** Excluded from income: internal transfers, plus reimbursements/transfers-in, which are
 * netted against spending instead (see SPENDING_EXCLUDED_CATEGORIES) rather than counted twice. */
const INCOME_EXCLUDED_CATEGORIES = ["CREDIT_CARD_PAYMENT", "TRANSFER_IN"];

function categoryNotIn(excluded: string[]) {
  // notInArray evaluates to NULL (excluding the row) for a NULL column, so uncategorized
  // transactions need an explicit isNull escape hatch to stay included.
  return or(isNull(transactions.categoryPrimary), notInArray(transactions.categoryPrimary, excluded));
}

export async function getSpendingSummary(mode: InsightsMode, year: number, month: number): Promise<SpendingSummary> {
  const db = getDb();
  const { start, end } = resolveInsightsRange(mode, year, month);
  const dateFilter = and(gte(transactions.date, start), lt(transactions.date, end));
  const spendingFilter = and(dateFilter, categoryNotIn(SPENDING_EXCLUDED_CATEGORIES));
  const incomeFilter = and(dateFilter, categoryNotIn(INCOME_EXCLUDED_CATEGORIES));

  const [categoryRows, spendingRows, incomeRows] = await Promise.all([
    db
      .select({
        category: transactions.categoryPrimary,
        // Net all signed amounts per category so refunds, reimbursements, and transfers-in
        // reduce that category's total instead of silently disappearing into "income".
        amountMilliunits: sql<number>`sum(${transactions.amountMilliunits})`.as("total_amount"),
      })
      .from(transactions)
      .where(spendingFilter)
      .groupBy(transactions.categoryPrimary)
      .orderBy(sql`total_amount desc`),
    db
      .select({ totalSpending: sql<number>`coalesce(sum(${transactions.amountMilliunits}), 0)` })
      .from(transactions)
      .where(spendingFilter),
    db
      .select({ totalIncome: sql<number>`coalesce(sum(-${transactions.amountMilliunits}), 0)` })
      .from(transactions)
      .where(and(incomeFilter, sql`${transactions.amountMilliunits} < 0`)),
  ]);

  return {
    mode,
    year,
    month,
    startDate: start,
    endDate: end,
    totalSpendingMilliunits: spendingRows[0]?.totalSpending ?? 0,
    totalIncomeMilliunits: incomeRows[0]?.totalIncome ?? 0,
    byCategory: categoryRows.map((row) => ({ category: row.category, amountMilliunits: row.amountMilliunits })),
  };
}
