import { and, eq, isNull, notInArray, or } from "drizzle-orm";
import { getDb } from "../db";
import { transactions } from "../db/schema";

/** Not spend toward a card's minimum-spend requirement: paying down the balance, or a
 * transfer/income landing on the card rather than a purchase. */
const NON_SPEND_CATEGORIES = ["CREDIT_CARD_PAYMENT", "TRANSFER_IN", "TRANSFER_OUT", "INCOME"];

export type CardSpendSummary = {
  accountId: string;
  transactionCount: number;
  grossSpendMilliunits: number;
  refundMilliunits: number;
  netSpendMilliunits: number;
  firstDate: string | null;
  lastDate: string | null;
};

export async function getCardSpendSummary(accountId: string): Promise<CardSpendSummary> {
  const db = getDb();
  const rows = await db
    .select({
      amountMilliunits: transactions.amountMilliunits,
      date: transactions.date,
    })
    .from(transactions)
    .where(and(
      eq(transactions.accountId, accountId),
      or(isNull(transactions.categoryPrimary), notInArray(transactions.categoryPrimary, NON_SPEND_CATEGORIES)),
    ));

  let grossSpendMilliunits = 0;
  let refundMilliunits = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  for (const row of rows) {
    if (row.amountMilliunits > 0) grossSpendMilliunits += row.amountMilliunits;
    else refundMilliunits += -row.amountMilliunits;
    if (firstDate === null || row.date < firstDate) firstDate = row.date;
    if (lastDate === null || row.date > lastDate) lastDate = row.date;
  }

  return {
    accountId,
    transactionCount: rows.length,
    grossSpendMilliunits,
    refundMilliunits,
    netSpendMilliunits: grossSpendMilliunits - refundMilliunits,
    firstDate,
    lastDate,
  };
}
