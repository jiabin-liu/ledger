import { and, asc, eq, isNull, notInArray, or } from "drizzle-orm";
import { getDb } from "../db";
import { accounts, transactions } from "../db/schema";

export type RecurringCadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export type RecurringOccurrence = {
  transactionId: string;
  date: string;
  amountMilliunits: number;
  name: string;
  merchantName: string | null;
  accountId: string;
  accountName: string | null;
  isoCurrencyCode: string | null;
  pending: boolean;
};

export type RecurringGroup = {
  key: string;
  label: string;
  logoUrl: string | null;
  categoryPrimary: string | null;
  cadence: RecurringCadence;
  occurrenceCount: number;
  lastAmountMilliunits: number;
  averageAmountMilliunits: number;
  monthlyEquivalentMilliunits: number;
  firstDate: string;
  lastDate: string;
  nextExpectedDate: string;
  likelyEnded: boolean;
  occurrences: RecurringOccurrence[];
};

/** Not "expenses": moving money between your own accounts or money coming in. */
const EXCLUDED_CATEGORIES = ["CREDIT_CARD_PAYMENT", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "INCOME"];

/** Real expenses, but too irregular to be "recurring" — repeat visits to the same coffee
 * shop or restaurant aren't a subscription even when the amount happens to line up. */
const NON_RECURRING_CATEGORIES = ["FOOD_AND_DRINK"];

/** A group whose last charge is older than this counts as lapsed/canceled, not recurring. */
const STALE_AFTER_MONTHS = 18;

const CADENCE_RANGES: { cadence: RecurringCadence; minDays: number; maxDays: number; monthsPerCycle: number }[] = [
  { cadence: "weekly", minDays: 6, maxDays: 9, monthsPerCycle: 12 / 52 },
  { cadence: "biweekly", minDays: 12, maxDays: 17, monthsPerCycle: 12 / 26 },
  { cadence: "monthly", minDays: 25, maxDays: 35, monthsPerCycle: 1 },
  { cadence: "quarterly", minDays: 80, maxDays: 100, monthsPerCycle: 3 },
  { cadence: "yearly", minDays: 340, maxDays: 400, monthsPerCycle: 12 },
];

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function classifyDelta(days: number) {
  return CADENCE_RANGES.find((range) => days >= range.minDays && days <= range.maxDays) ?? null;
}

/** Strips order/reference codes and store numbers so the same merchant groups together
 * across slightly different Plaid transaction names (e.g. "AMAZON PRIME*RT4XY" vs "*AB12C"). */
function normalizeMerchantKey(rawName: string): string {
  let value = rawName.toUpperCase();
  value = value.replace(/[^A-Z0-9 ]+/g, " ");
  value = value.replace(/\b[A-Z]*[0-9]{3,}[A-Z0-9]*\b/g, " ");
  value = value.replace(/\s+/g, " ").trim();
  const tokens = value.split(" ").filter(Boolean);
  return tokens.slice(0, 4).join(" ");
}

function addDays(date: string, days: number) {
  const next = new Date(Date.parse(date) + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

function monthsAgo(months: number, reference = new Date()) {
  const date = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

type Row = {
  transactionId: string;
  accountId: string;
  accountName: string | null;
  name: string;
  merchantName: string | null;
  amountMilliunits: number;
  isoCurrencyCode: string | null;
  date: string;
  pending: boolean;
  categoryPrimary: string | null;
  logoUrl: string | null;
};

/** Splits amounts-sorted rows into clusters, starting a new cluster whenever the gap to the
 * previous amount is large — separates a subscription's steady price from unrelated purchases
 * at the same merchant while still tolerating small tax/price-increase drift within a cluster. */
function clusterByAmount(rows: Row[]): Row[][] {
  const sorted = [...rows].sort((a, b) => a.amountMilliunits - b.amountMilliunits);
  const clusters: Row[][] = [];
  let current: Row[] = [];
  for (const row of sorted) {
    if (current.length === 0) {
      current.push(row);
      continue;
    }
    const previous = current[current.length - 1];
    const gap = row.amountMilliunits - previous.amountMilliunits;
    const threshold = Math.max(previous.amountMilliunits * 0.15, 2000);
    if (gap > threshold) {
      clusters.push(current);
      current = [row];
    } else {
      current.push(row);
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

function detectCadence(datesAsc: string[]): RecurringCadence | null {
  if (datesAsc.length < 2) return null;
  const counts = new Map<RecurringCadence, number>();
  for (let i = 1; i < datesAsc.length; i++) {
    const match = classifyDelta(daysBetween(datesAsc[i - 1], datesAsc[i]));
    if (!match) continue;
    counts.set(match.cadence, (counts.get(match.cadence) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const totalDeltas = datesAsc.length - 1;
  let best: RecurringCadence | null = null;
  let bestCount = 0;
  for (const [cadence, cadenceCount] of counts) {
    if (cadenceCount > bestCount) {
      best = cadence;
      bestCount = cadenceCount;
    }
  }
  // Require the majority of gaps to agree so an occasional one-off purchase at the same
  // merchant/amount doesn't get mistaken for a break in an otherwise-regular cadence.
  if (best && bestCount / totalDeltas >= 0.5) return best;
  return null;
}

export async function getRecurringExpenses(): Promise<RecurringGroup[]> {
  const db = getDb();
  const todayString = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      transactionId: transactions.transactionId,
      accountId: transactions.accountId,
      accountName: accounts.name,
      name: transactions.name,
      merchantName: transactions.merchantName,
      amountMilliunits: transactions.amountMilliunits,
      isoCurrencyCode: transactions.isoCurrencyCode,
      date: transactions.date,
      pending: transactions.pending,
      categoryPrimary: transactions.categoryPrimary,
      logoUrl: transactions.logoUrl,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.accountId))
    .where(and(
      or(
        isNull(transactions.categoryPrimary),
        notInArray(transactions.categoryPrimary, [...EXCLUDED_CATEGORIES, ...NON_RECURRING_CATEGORIES]),
      ),
    ))
    .orderBy(asc(transactions.date));

  const byMerchant = new Map<string, Row[]>();
  for (const row of rows) {
    if (row.amountMilliunits <= 0) continue;
    if (row.pending) continue;
    const key = normalizeMerchantKey(row.merchantName ?? row.name);
    if (!key) continue;
    const bucket = byMerchant.get(key);
    if (bucket) bucket.push(row);
    else byMerchant.set(key, [row]);
  }

  const groups: RecurringGroup[] = [];
  for (const [merchantKey, merchantRows] of byMerchant) {
    for (const cluster of clusterByAmount(merchantRows)) {
      if (cluster.length < 2) continue;
      const byDate = [...cluster].sort((a, b) => a.date.localeCompare(b.date));
      const cadence = detectCadence(byDate.map((row) => row.date));
      if (!cadence) continue;

      const range = CADENCE_RANGES.find((entry) => entry.cadence === cadence)!;
      const last = byDate[byDate.length - 1];
      const first = byDate[0];
      const totalAmount = byDate.reduce((sum, row) => sum + row.amountMilliunits, 0);
      const averageAmountMilliunits = Math.round(totalAmount / byDate.length);
      const label = (last.merchantName ?? last.name).trim();
      const amountKey = Math.round(averageAmountMilliunits / 1000);
      const nextExpectedDate = addDays(last.date, Math.round((range.minDays + range.maxDays) / 2));
      // Use the outer edge of the observed cadence window (not the midpoint estimate above)
      // before calling it "ended", so a payment that's merely a few days later than usual
      // isn't mistaken for a lapsed subscription.
      const lapsedAfterDate = addDays(last.date, range.maxDays);

      groups.push({
        key: `${merchantKey}::${amountKey}`,
        label,
        logoUrl: byDate.map((row) => row.logoUrl).reverse().find((url) => url) ?? null,
        categoryPrimary: last.categoryPrimary,
        cadence,
        occurrenceCount: byDate.length,
        lastAmountMilliunits: last.amountMilliunits,
        averageAmountMilliunits,
        monthlyEquivalentMilliunits: Math.round(averageAmountMilliunits / range.monthsPerCycle),
        firstDate: first.date,
        lastDate: last.date,
        nextExpectedDate,
        // The newest occurrence we have is `last`, so if we're past the widest historical gap
        // for this cadence and still haven't seen another charge, it's likely lapsed rather
        // than just running a little late.
        likelyEnded: lapsedAfterDate < todayString,
        occurrences: byDate
          .slice()
          .reverse()
          .map((row) => ({
            transactionId: row.transactionId,
            date: row.date,
            amountMilliunits: row.amountMilliunits,
            name: row.name,
            merchantName: row.merchantName,
            accountId: row.accountId,
            accountName: row.accountName,
            isoCurrencyCode: row.isoCurrencyCode,
            pending: row.pending,
          })),
      });
    }
  }

  const staleCutoff = monthsAgo(STALE_AFTER_MONTHS);
  const active = groups.filter((group) => group.lastDate >= staleCutoff);
  active.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  return active;
}
