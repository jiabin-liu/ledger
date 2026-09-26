import { and, asc, count, desc, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { accounts, plaidItems, transactions } from "../db/schema";
import { ensurePeriodsForYear, listBenefitBundle } from "../lib/benefits";
import { getDeployVersion } from "../lib/deploy-version";
import { isTriageStatus } from "../lib/triage";
import { getLedgerOwner } from "./access-auth";
import { TransactionDashboard } from "./transaction-dashboard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const emptyBenefits = {
  products: [] as Awaited<ReturnType<typeof listBenefitBundle>>["products"],
  defs: [] as Awaited<ReturnType<typeof listBenefitBundle>>["defs"],
  assignments: [] as Awaited<ReturnType<typeof listBenefitBundle>>["assignments"],
  periods: [] as Awaited<ReturnType<typeof listBenefitBundle>>["periods"],
  year: new Date().getFullYear(),
};

function categoryFilterValue(raw: string | undefined) {
  const value = raw?.trim() ?? "";
  if (!value || value === "all") return "all";
  return value;
}

/** Calendar year for transaction date filter; `all` when unset/invalid. */
function txYearFilterValue(raw: string | undefined) {
  const value = raw?.trim() ?? "";
  if (!value || value === "all") return "all";
  if (!/^\d{4}$/.test(value)) return "all";
  const year = Number.parseInt(value, 10);
  if (!Number.isFinite(year) || year < 1990 || year > 2100) return "all";
  return value;
}

/** Month `01`–`12` for transaction date filter; `all` when unset/invalid. */
function txMonthFilterValue(raw: string | undefined) {
  const value = raw?.trim() ?? "";
  if (!value || value === "all") return "all";
  if (!/^(0[1-9]|1[0-2])$/.test(value)) return "all";
  return value;
}

/** Escapes SQLite LIKE wildcards so a search term is matched literally. */
function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function nextMonthStart(year: number, month: number) {
  if (month === 12) return `${year + 1}-01-01`;
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    page?: string;
    institution?: string;
    account?: string;
    triage?: string;
    categoryPrimary?: string;
    categoryDetailed?: string;
    year?: string;
    month?: string;
    search?: string;
  }>;
}) {
  const owner = await getLedgerOwner();
  const email = owner?.email ?? null;
  const deployVersion = getDeployVersion();
  const params = await searchParams;
  const activeTab = ["accounts", "transactions", "benefits", "insights", "recurring", "cardspend", "rewards"].includes(params.tab ?? "")
    ? params.tab!
    : "accounts";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const selectedInstitution = params.institution ?? "all";
  const selectedAccount = params.account ?? "all";
  const selectedTriage = isTriageStatus(params.triage) ? params.triage : "all";
  const selectedCategoryPrimary = categoryFilterValue(params.categoryPrimary);
  const selectedCategoryDetailed = categoryFilterValue(params.categoryDetailed);
  // `year` is shared URL key: transactions date filter when tab=transactions; Benefits year when tab=benefits.
  const selectedTxYear = activeTab === "transactions" ? txYearFilterValue(params.year) : "all";
  const selectedTxMonth = activeTab === "transactions" ? txMonthFilterValue(params.month) : "all";
  const selectedSearch = activeTab === "transactions" ? (params.search?.trim() ?? "") : "";
  const requestedBenefitsYear = Number.parseInt(params.year ?? "", 10);
  const benefitsYear = activeTab === "benefits" && Number.isFinite(requestedBenefitsYear)
    ? requestedBenefitsYear
    : new Date().getFullYear();
  const filterParts = [
    selectedAccount !== "all"
      ? eq(transactions.accountId, selectedAccount)
      : selectedInstitution !== "all"
        ? eq(transactions.itemId, selectedInstitution)
        : undefined,
    selectedTriage !== "all" ? eq(transactions.triage, selectedTriage) : undefined,
    selectedCategoryPrimary === "uncategorized"
      ? isNull(transactions.categoryPrimary)
      : selectedCategoryPrimary !== "all"
        ? eq(transactions.categoryPrimary, selectedCategoryPrimary)
        : undefined,
    selectedCategoryDetailed === "uncategorized"
      ? isNull(transactions.categoryDetailed)
      : selectedCategoryDetailed !== "all"
        ? eq(transactions.categoryDetailed, selectedCategoryDetailed)
        : undefined,
    selectedTxYear !== "all" && selectedTxMonth !== "all"
      ? and(
        gte(transactions.date, `${selectedTxYear}-${selectedTxMonth}-01`),
        lt(
          transactions.date,
          nextMonthStart(Number.parseInt(selectedTxYear, 10), Number.parseInt(selectedTxMonth, 10)),
        ),
      )
      : selectedTxYear !== "all"
        ? and(
          gte(transactions.date, `${selectedTxYear}-01-01`),
          lt(transactions.date, `${Number.parseInt(selectedTxYear, 10) + 1}-01-01`),
        )
        : selectedTxMonth !== "all"
          ? sql`substr(${transactions.date}, 6, 2) = ${selectedTxMonth}`
          : undefined,
    selectedSearch
      ? sql`(${transactions.name} LIKE ${`%${escapeLikePattern(selectedSearch)}%`} ESCAPE '\\' OR ${transactions.merchantName} LIKE ${`%${escapeLikePattern(selectedSearch)}%`} ESCAPE '\\')`
      : undefined,
  ].filter((part): part is NonNullable<typeof part> => Boolean(part));
  const transactionFilter = filterParts.length > 0 ? and(...filterParts) : undefined;

  try {
    const db = getDb();
    const [accountRows, itemRows, countRows, categoryOptionRows, txYearRows, benefitsBundle] = await Promise.all([
      db
        .select({
          accountId: accounts.accountId,
          itemId: accounts.itemId,
          institutionName: plaidItems.institutionName,
          institutionLogo: plaidItems.institutionLogo,
          institutionPrimaryColor: plaidItems.institutionPrimaryColor,
          name: accounts.name,
          officialName: accounts.officialName,
          mask: accounts.mask,
          displayMask: accounts.displayMask,
          type: accounts.type,
          subtype: accounts.subtype,
          currentBalanceMilliunits: accounts.currentBalanceMilliunits,
          availableBalanceMilliunits: accounts.availableBalanceMilliunits,
          isoCurrencyCode: accounts.isoCurrencyCode,
          sortOrder: accounts.sortOrder,
          updatedAt: accounts.updatedAt,
        })
        .from(accounts)
        .leftJoin(plaidItems, eq(accounts.itemId, plaidItems.itemId))
        // A "disconnected" item was intentionally revoked and replaced (e.g. an institution
        // reconnect); keep its transaction history queryable but stop surfacing the stale
        // account itself as something to view, sync, or pick for a card in the UI.
        .where(or(isNull(plaidItems.status), ne(plaidItems.status, "disconnected")))
        .orderBy(asc(plaidItems.institutionName), asc(accounts.sortOrder), asc(accounts.name)),
      db
        .select({
          itemId: plaidItems.itemId,
          institutionName: plaidItems.institutionName,
          institutionLogo: plaidItems.institutionLogo,
          institutionPrimaryColor: plaidItems.institutionPrimaryColor,
          status: plaidItems.status,
          updatedAt: plaidItems.updatedAt,
        })
        .from(plaidItems)
        .where(ne(plaidItems.status, "disconnected")),
      db.select({ total: count() }).from(transactions).where(transactionFilter),
      db
        .selectDistinct({
          primary: transactions.categoryPrimary,
          detailed: transactions.categoryDetailed,
        })
        .from(transactions)
        .where(sql`${transactions.categoryPrimary} is not null or ${transactions.categoryDetailed} is not null`)
        .orderBy(asc(transactions.categoryPrimary), asc(transactions.categoryDetailed)),
      db
        .selectDistinct({
          year: sql<string>`substr(${transactions.date}, 1, 4)`.as("tx_year"),
        })
        .from(transactions)
        .orderBy(desc(sql`substr(${transactions.date}, 1, 4)`)),
      (async () => {
        try {
          await ensurePeriodsForYear(benefitsYear);
          return await listBenefitBundle(benefitsYear);
        } catch (error) {
          console.error("Failed to load benefits bundle", error);
          return { ...emptyBenefits, year: benefitsYear };
        }
      })(),
    ]);

    const totalTransactions = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalTransactions / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const transactionYearOptions = txYearRows
      .map((row) => row.year)
      .filter((year) => /^\d{4}$/.test(year));
    const transactionRows = await db
      .select({
        transactionId: transactions.transactionId,
        accountId: transactions.accountId,
        accountName: accounts.name,
        accountOfficialName: accounts.officialName,
        accountType: accounts.type,
        accountSubtype: accounts.subtype,
        accountMask: sql<string | null>`coalesce(${accounts.displayMask}, ${accounts.mask})`.as("account_mask"),
        institutionName: plaidItems.institutionName,
        name: transactions.name,
        merchantName: transactions.merchantName,
        originalDescription: transactions.originalDescription,
        amountMilliunits: transactions.amountMilliunits,
        isoCurrencyCode: transactions.isoCurrencyCode,
        date: transactions.date,
        authorizedDate: transactions.authorizedDate,
        pending: transactions.pending,
        categoryPrimary: transactions.categoryPrimary,
        categoryDetailed: transactions.categoryDetailed,
        paymentChannel: transactions.paymentChannel,
        logoUrl: transactions.logoUrl,
        website: transactions.website,
        note: transactions.note,
        triage: transactions.triage,
        updatedAt: transactions.updatedAt,
      })
      .from(transactions)
      .leftJoin(accounts, eq(transactions.accountId, accounts.accountId))
      .leftJoin(plaidItems, eq(transactions.itemId, plaidItems.itemId))
      .where(transactionFilter)
      .orderBy(desc(transactions.date), desc(transactions.transactionId))
      .limit(PAGE_SIZE)
      .offset((safePage - 1) * PAGE_SIZE);

    return (
      <TransactionDashboard
        activeTab={activeTab}
        transactions={transactionRows}
        totalTransactions={totalTransactions}
        page={safePage}
        pageSize={PAGE_SIZE}
        accounts={accountRows}
        institutions={itemRows}
        categoryOptions={categoryOptionRows}
        transactionYearOptions={transactionYearOptions}
        selectedInstitution={selectedInstitution}
        selectedAccountId={selectedAccount}
        selectedTriage={selectedTriage}
        selectedCategoryPrimary={selectedCategoryPrimary}
        selectedCategoryDetailed={selectedCategoryDetailed}
        selectedTxYear={selectedTxYear}
        selectedTxMonth={selectedTxMonth}
        selectedSearch={selectedSearch}
        viewerEmail={email}
        deployVersion={deployVersion}
        benefitsBundle={benefitsBundle}
      />
    );
  } catch (error) {
    console.error("Failed to load dashboard data", error);
    return (
      <TransactionDashboard
        activeTab={activeTab}
        transactions={[]}
        totalTransactions={0}
        page={1}
        pageSize={PAGE_SIZE}
        accounts={[]}
        institutions={[]}
        categoryOptions={[]}
        transactionYearOptions={[]}
        selectedInstitution={selectedInstitution}
        selectedAccountId={selectedAccount}
        selectedTriage={selectedTriage}
        selectedCategoryPrimary={selectedCategoryPrimary}
        selectedCategoryDetailed={selectedCategoryDetailed}
        selectedTxYear={selectedTxYear}
        selectedTxMonth={selectedTxMonth}
        selectedSearch={selectedSearch}
        viewerEmail={email}
        deployVersion={deployVersion}
        databasePending
        benefitsBundle={emptyBenefits}
      />
    );
  }
}
