"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft, Check, ChevronDown, Circle, Coins, CreditCard, Gift, GripVertical, HelpCircle, LayoutGrid, Link2, List, PieChart, Plus, RefreshCw, Search, StickyNote, X } from "lucide-react";
import { InsightsPanel } from "./insights-panel";
import { RewardsPanel } from "./rewards-panel";
import { CategoryEditor } from "./category-editor";
import {
  DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { resolveCardArt } from "../lib/card-art";
import { formatAccountMask, isAmexInstitution } from "../lib/account-display";
import { resolveInstitutionIcon } from "../lib/institution-icons";
import { normalizeTriage, type TriageStatus } from "../lib/triage";
import { BenefitsPanel } from "./benefits-panel";

type TriageFilter = "all" | TriageStatus;

declare global {
  interface Window {
    Plaid?: { create(config: Record<string, unknown>): { open(): void; destroy(): void } };
  }
}

type Transaction = {
  transactionId: string; accountId: string; accountName: string | null; accountOfficialName: string | null;
  accountType: string | null; accountSubtype: string | null; accountMask: string | null;
  institutionName: string | null; name: string; merchantName: string | null; originalDescription: string | null;
  amountMilliunits: number; isoCurrencyCode: string | null; date: string; authorizedDate: string | null;
  pending: boolean; categoryPrimary: string | null; categoryDetailed: string | null;
  paymentChannel: string | null; logoUrl: string | null; website: string | null; note: string | null;
  triage: TriageStatus; updatedAt: string;
};

type Account = {
  accountId: string; itemId: string; institutionName: string | null; name: string; officialName: string | null;
  institutionLogo: string | null; institutionPrimaryColor: string | null;
  mask: string | null; displayMask: string | null; type: string; subtype: string | null; currentBalanceMilliunits: number | null;
  availableBalanceMilliunits: number | null; isoCurrencyCode: string | null; updatedAt: string;
  sortOrder: number;
};

type Institution = { itemId: string; institutionName: string; institutionLogo: string | null; institutionPrimaryColor: string | null; status: string; updatedAt: string };
type CategoryOption = { primary: string | null; detailed: string | null };

type BenefitsBundle = {
  products: { id: number; name: string; createdAt: string; updatedAt: string }[];
  defs: {
    id: number; productId: number; name: string; amountMilliunits: number; cadence: string;
    effectiveFromYear: number | null; effectiveFromPeriod: string | null;
    effectiveToYear: number | null; effectiveToPeriod: string | null; sortOrder: number;
  }[];
  assignments: { id: number; accountId: string; productId: number }[];
  periods: { id: number; accountId: string; benefitDefId: number; year: number; periodKey: string; status: string }[];
  year: number;
};

function money(value: number | null, currency = "USD") {
  if (value === null) return "Not available";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value / 1000);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

function formatDateGroup(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

function accountKind(account: Account) {
  if (account.type === "credit") return "Credit account";
  if (account.subtype === "checking") return "Checking account";
  if (account.subtype === "savings") return "Savings account";
  if (account.type === "investment" || account.subtype === "brokerage") return "Brokerage account";
  return `${account.subtype ?? account.type} account`;
}

function accountBucket(account: Account): "credit" | "cash" | "investment" | "other" {
  if (account.type === "credit") return "credit";
  if (account.subtype === "checking" || account.subtype === "savings") return "cash";
  if (account.type === "investment" || account.subtype === "brokerage") return "investment";
  return "other";
}

const ACCOUNT_BUCKET_LABELS: Record<"credit" | "cash" | "investment" | "other", string> = {
  credit: "Credit cards",
  cash: "Checking & savings",
  investment: "Investments",
  other: "Other accounts",
};

function initials(value: string) {
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function accountKindLabel(type: string | null | undefined, subtype: string | null | undefined) {
  if (type === "credit" || subtype === "credit card") return "Credit";
  if (subtype === "checking") return "Checking";
  if (subtype === "savings") return "Saving";
  if (type === "investment" || subtype === "brokerage") return "Investment";
  if (subtype) return subtype.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
  if (type) return type.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
  return "Account";
}

function transactionAccountLine(transaction: {
  institutionName: string | null;
  accountType: string | null;
  accountSubtype: string | null;
  accountMask: string | null;
}) {
  const parts = [
    transaction.institutionName ?? "Institution",
    accountKindLabel(transaction.accountType, transaction.accountSubtype),
  ];
  if (transaction.accountMask) parts.push(transaction.accountMask);
  return parts.join(" · ");
}

function categoryBadgeLabel(value: string | null) {
  const formatted = formatCategory(value);
  if (!formatted) return null;
  return formatted.replace(/bw/g, (char) => char.toUpperCase());
}

function formatCategory(value: string | null) {
  return value?.replaceAll("_", " ") ?? null;
}

function categoryLabel(value: string) {
  if (value === "all") return "All categories";
  if (value === "uncategorized") return "Uncategorized";
  return formatCategory(value) ?? value;
}

function detailedCategoryLabel(value: string, primary?: string | null) {
  if (value === "all") return "All details";
  if (value === "uncategorized") return "Uncategorized";
  const formatted = formatCategory(value) ?? value;
  if (primary && value.startsWith(`${primary}_`)) {
    return formatCategory(value.slice(primary.length + 1)) ?? formatted;
  }
  return formatted;
}

function dash(value: string | null | undefined) {
  return value && value.trim() ? value : "—";
}

function institutionIconSrc(institutionName: string | null | undefined, plaidLogo?: string | null) {
  return resolveInstitutionIcon(institutionName) ?? plaidLogo ?? null;
}

export function TransactionDashboard({
  activeTab, transactions, totalTransactions, page, pageSize, accounts, institutions, categoryOptions,
  transactionYearOptions,
  selectedInstitution, selectedAccountId, selectedTriage, selectedCategoryPrimary, selectedCategoryDetailed,
  selectedTxYear, selectedTxMonth, selectedSearch,
  viewerEmail, deployVersion,
  databasePending = false,
  benefitsBundle,
}: {
  activeTab: string;
  transactions: Transaction[];
  totalTransactions: number;
  page: number;
  pageSize: number;
  accounts: Account[];
  institutions: Institution[];
  categoryOptions: CategoryOption[];
  transactionYearOptions: string[];
  selectedInstitution: string;
  selectedAccountId: string;
  selectedTriage: TriageFilter;
  selectedCategoryPrimary: string;
  selectedCategoryDetailed: string;
  selectedTxYear: string;
  selectedTxMonth: string;
  selectedSearch: string;
  viewerEmail: string | null;
  deployVersion: { id: string; tag: string | null; timestamp: string | null } | null;
  databasePending?: boolean;
  benefitsBundle: BenefitsBundle;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [tab, setTab] = useState(activeTab);
  const [busy, setBusy] = useState(false);
  const [reconnectingItemId, setReconnectingItemId] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [plaidReady, setPlaidReady] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const selectedTransactionRef = useRef<Transaction | null>(null);
  const [transactionRows, setTransactionRows] = useState(() => transactions.map((transaction) => ({
    ...transaction,
    triage: normalizeTriage((transaction as Transaction & { triage?: string | null }).triage),
  })));
  const transactionPatchesRef = useRef(new Map<string, { note?: string | null; triage?: TriageStatus; categoryPrimary?: string | null; categoryDetailed?: string | null }>());
  const [noteDraft, setNoteDraft] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const suppressNoteBlurSaveRef = useRef(false);
  const editingNoteIdRef = useRef<string | null>(null);
  const noteDraftRef = useRef("");
  const listNoteInputRef = useRef<HTMLInputElement | null>(null);
  const detailNoteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingListNoteFocusRef = useRef(false);
  const [displayMaskDraft, setDisplayMaskDraft] = useState("");
  const [savingDisplayMask, setSavingDisplayMask] = useState(false);
  const [orderedAccounts, setOrderedAccounts] = useState(accounts);
  const [expandedInstitutions, setExpandedInstitutions] = useState<Set<string>>(new Set());
  const [benefitsDetailOpen, setBenefitsDetailOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(selectedSearch);
  const searchDebounceRef = useRef<number | null>(null);
  const detailSheetRef = useRef<HTMLElement | null>(null);
  const appScrollRef = useRef<HTMLDivElement | null>(null);
  const focusedDetailFieldRef = useRef<HTMLElement | null>(null);
  const detailHistoryPushedRef = useRef(false);
  const benefitsDetailHistoryRef = useRef(false);
  const coverScrollYRef = useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    setTab(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (window.Plaid) { setPlaidReady(true); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => setPlaidReady(true);
    document.head.appendChild(script);
    return () => script.remove();
  }, []);

  useEffect(() => {
    selectedTransactionRef.current = selectedTransaction;
  }, [selectedTransaction]);

  const flushDetailNote = () => {
    const selected = selectedTransactionRef.current;
    if (!selected) return;
    const draft = noteDraftRef.current;
    const nextNote = draft.trim() ? draft.trim() : null;
    if (nextNote === (selected.note ?? null)) return;
    const currentPatch = transactionPatchesRef.current.get(selected.transactionId) ?? {};
    transactionPatchesRef.current.set(selected.transactionId, { ...currentPatch, note: nextNote });
    selectedTransactionRef.current = { ...selected, note: nextNote };
    setTransactionRows((rows) => rows.map((transaction) => (
      transaction.transactionId === selected.transactionId ? { ...transaction, note: nextNote } : transaction
    )));
    void fetch("/api/transactions/note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: selected.transactionId, note: nextNote }),
    }).catch(() => {
      // Keep the local patch; user can retry from detail later.
    });
  };

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const params = new URLSearchParams(window.location.search);
      const nextTab = ["accounts", "transactions", "benefits", "insights", "rewards"].includes(params.get("tab") ?? "")
        ? params.get("tab")!
        : "accounts";
      setTab(nextTab);

      // Only close detail when leaving a detail history entry. Ignore unrelated back/forward.
      if (detailHistoryPushedRef.current && !(event.state as { ledgerDetail?: string } | null)?.ledgerDetail) {
        detailHistoryPushedRef.current = false;
        const active = document.activeElement;
        if (active instanceof HTMLElement && detailSheetRef.current?.contains(active)) {
          active.blur();
        }
        flushDetailNote();
        setSelectedAccount(null);
        setSelectedTransaction(null);
        setDisplayMaskDraft("");
        setEditingNoteId(null);
        setNoteDraft("");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // Mobile Safari/Chrome can restore this page from the back-forward cache (bfcache) on
    // "refresh" instead of re-running the server component, showing whatever state (accounts,
    // benefit assignments, etc.) existed when the page was first loaded. Force a real reload
    // so a stale snapshot never masquerades as fresh data.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    // Quietly ask Plaid for anything new each time the app is opened, without requiring
    // the user to remember to tap "Sync". The server skips any institution it already
    // refreshed within the last 24h, so repeated opens in the same day are a no-op.
    if (databasePending) return;
    let cancelled = false;
    fetch("/api/plaid/sync?auto=1", { method: "POST" })
      .then((response) => response.json())
      .then((payload: { added?: number }) => {
        if (cancelled || !payload.added) return;
        setStatus(`Imported ${payload.added} new transaction${payload.added === 1 ? "" : "s"}.`);
        window.location.reload();
      })
      .catch(() => {
        // Silent: this is a background refresh, not a user-initiated action.
      });
    return () => {
      cancelled = true;
    };
  }, [databasePending]);

  useEffect(() => {
    const patches = transactionPatchesRef.current;
    setTransactionRows(transactions.map((transaction) => {
      const patch = patches.get(transaction.transactionId);
      return {
        ...transaction,
        triage: normalizeTriage(patch?.triage ?? transaction.triage),
        note: patch && "note" in patch ? patch.note ?? null : transaction.note,
      };
    }));
  }, [transactions]);

  useEffect(() => {
    editingNoteIdRef.current = editingNoteId;
  }, [editingNoteId]);

  useEffect(() => {
    noteDraftRef.current = noteDraft;
  }, [noteDraft]);

  useEffect(() => {
    if (tab !== "accounts" && !new URLSearchParams(window.location.search).has("oauth_state_id")) return;
    const oauthToken = localStorage.getItem("plaid-link-token");
    if (new URLSearchParams(window.location.search).has("oauth_state_id") && oauthToken) {
      setLinkToken(oauthToken); return;
    }
    fetch("/api/plaid/link-token", { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error ?? "Unable to start Plaid");
        return response.json();
      })
      .then(({ linkToken: token }) => { localStorage.setItem("plaid-link-token", token); setLinkToken(token); })
      .catch((error) => setStatus(error.message));
  }, [tab]);

  const createPlaidHandler = (token: string, isOAuthContinuation = false) => window.Plaid!.create({
    token,
    ...(isOAuthContinuation ? { receivedRedirectUri: window.location.href } : {}),
    onSuccess: async (publicToken: string, metadata: { institution?: { institution_id?: string; name?: string } }) => {
      setBusy(true); setStatus("Saving connection and importing transactions…");
      try {
        const response = await fetch("/api/plaid/exchange", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicToken, institutionId: metadata.institution?.institution_id, institutionName: metadata.institution?.name }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Connection could not be saved");
        localStorage.removeItem("plaid-link-token"); window.history.replaceState({}, "", "/?tab=accounts"); window.location.reload();
      } catch (error) { setStatus(error instanceof Error ? error.message : "Connection failed"); setBusy(false); }
    },
    onExit: (error: { display_message?: string; error_message?: string } | null) => {
      if (error) setStatus(error.display_message ?? error.error_message ?? "Plaid Link closed");
    },
  });

  useEffect(() => {
    if (!plaidReady || !linkToken || !window.Plaid || !new URLSearchParams(window.location.search).has("oauth_state_id")) return;
    const handler = createPlaidHandler(linkToken, true); handler.open(); return () => handler.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plaidReady, linkToken]);

  const connectBank = () => { if (plaidReady && linkToken && window.Plaid) createPlaidHandler(linkToken).open(); };
  const sync = async () => {
    setBusy(true); setStatus("Checking every connected institution…");
    try {
      const response = await fetch("/api/plaid/sync", { method: "POST" }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Sync failed");
      setStatus(`Imported ${payload.added} new transaction${payload.added === 1 ? "" : "s"}.`); window.location.reload();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Sync failed"); setBusy(false); }
  };

  const reconnectInstitution = async (itemId: string) => {
    setBusy(true); setReconnectingItemId(itemId); setStatus("Preparing reconnect…");
    try {
      const response = await fetch("/api/plaid/link-token", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to start reconnect");
      if (!window.Plaid) throw new Error("Plaid Link is still loading, try again in a moment.");
      const handler = window.Plaid.create({
        token: payload.linkToken,
        onSuccess: async () => {
          setStatus("Reconnected. Syncing…");
          try {
            const syncResponse = await fetch("/api/plaid/sync", { method: "POST" });
            const syncPayload = await syncResponse.json();
            if (!syncResponse.ok) throw new Error(syncPayload.error ?? "Sync failed");
            setStatus(`Reconnected. Imported ${syncPayload.added} new transaction${syncPayload.added === 1 ? "" : "s"}.`);
          } catch (error) { setStatus(error instanceof Error ? error.message : "Reconnected, but sync failed."); }
          window.location.reload();
        },
        onExit: (error: { display_message?: string; error_message?: string } | null) => {
          if (error) setStatus(error.display_message ?? error.error_message ?? "Reconnect closed");
          setBusy(false); setReconnectingItemId(null);
        },
      });
      handler.open();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to start reconnect");
      setBusy(false); setReconnectingItemId(null);
    }
  };

  const groupedAccounts = useMemo(() => {
    const byItem = new Map<string, Account[]>();
    for (const account of orderedAccounts) {
      byItem.set(account.itemId, [...(byItem.get(account.itemId) ?? []), account]);
    }
    const groups = institutions.map((institution) => ({
      institution,
      accounts: byItem.get(institution.itemId) ?? [],
    }));
    // Include any orphaned accounts whose item row is missing.
    for (const [itemId, rows] of byItem) {
      if (groups.some((group) => group.institution.itemId === itemId)) continue;
      groups.push({
        institution: {
          itemId,
          institutionName: rows[0]?.institutionName ?? "Connected institution",
          institutionLogo: rows[0]?.institutionLogo ?? null,
          institutionPrimaryColor: rows[0]?.institutionPrimaryColor ?? null,
          status: "unknown",
          updatedAt: rows[0]?.updatedAt ?? new Date().toISOString(),
        },
        accounts: rows,
      });
    }
    return groups;
  }, [orderedAccounts, institutions]);

  const accountSummary = useMemo(() => {
    let cash = 0;
    let credit = 0;
    let investments = 0;
    let cashAccounts = 0;
    let creditAccounts = 0;
    let investmentAccounts = 0;

    for (const account of orderedAccounts) {
      if (account.currentBalanceMilliunits === null) continue;
      const bucket = accountBucket(account);
      if (bucket === "credit") {
        credit += account.currentBalanceMilliunits;
        creditAccounts += 1;
      } else if (bucket === "cash") {
        cash += account.currentBalanceMilliunits;
        cashAccounts += 1;
      } else if (bucket === "investment") {
        investments += account.currentBalanceMilliunits;
        investmentAccounts += 1;
      }
    }

    return { cash, credit, investments, cashAccounts, creditAccounts, investmentAccounts };
  }, [orderedAccounts]);

  const reorderAccounts = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = orderedAccounts.findIndex((account) => account.accountId === active.id);
    const newIndex = orderedAccounts.findIndex((account) => account.accountId === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const from = orderedAccounts[oldIndex];
    const to = orderedAccounts[newIndex];
    if (from.institutionName !== to.institutionName || accountBucket(from) !== accountBucket(to)) return;
    const previous = orderedAccounts;
    const next = arrayMove(orderedAccounts, oldIndex, newIndex);
    setOrderedAccounts(next);
    try {
      const response = await fetch("/api/accounts/reorder", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds: next.map((account) => account.accountId) }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Unable to save account order");
    } catch (error) {
      setOrderedAccounts(previous);
      setStatus(error instanceof Error ? error.message : "Unable to save account order");
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalTransactions / pageSize));
  const pageStart = totalTransactions ? (page - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(page * pageSize, totalTransactions);
  const pageTitle = tab === "transactions"
    ? (selectedTransaction ? "Transaction" : "Transactions")
    : tab === "benefits"
      ? "Benefits"
      : tab === "insights"
        ? "Spending"
        : tab === "rewards"
          ? "Rewards"
      : selectedAccount
        ? "Account"
        : "Accounts";
  const creditAccounts = orderedAccounts
    .filter((account) => account.type === "credit")
    .map((account) => ({
      accountId: account.accountId,
      name: account.name,
      officialName: account.officialName,
      mask: account.mask,
      displayMask: account.displayMask,
      type: account.type,
      institutionName: account.institutionName,
      institutionLogo: account.institutionLogo,
      institutionPrimaryColor: account.institutionPrimaryColor,
    }));
  const accountFilterGroups = useMemo(() => {
    const source = selectedInstitution === "all"
      ? groupedAccounts
      : groupedAccounts.filter((group) => group.institution.itemId === selectedInstitution);
    return source
      .map(({ institution, accounts }) => ({
        itemId: institution.itemId,
        institutionName: institution.institutionName,
        buckets: (["credit", "cash", "investment", "other"] as const)
          .map((bucket) => ({
            bucket,
            label: ACCOUNT_BUCKET_LABELS[bucket],
            accounts: accounts.filter((account) => accountBucket(account) === bucket),
          }))
          .filter((bucket) => bucket.accounts.length > 0),
      }))
      .filter((group) => group.buckets.length > 0);
  }, [groupedAccounts, selectedInstitution]);
  const categoryPrimaryOptions = useMemo(() => {
    const values = new Set<string>();
    for (const row of categoryOptions) {
      if (row.primary) values.add(row.primary);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [categoryOptions]);
  const categoryDetailedOptions = useMemo(() => {
    const values = new Set<string>();
    for (const row of categoryOptions) {
      if (!row.detailed) continue;
      if (
        selectedCategoryPrimary !== "all"
        && selectedCategoryPrimary !== "uncategorized"
        && row.primary !== selectedCategoryPrimary
      ) {
        continue;
      }
      values.add(row.detailed);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [categoryOptions, selectedCategoryPrimary]);
  const transactionHref = (nextPage: number) => {
    const query = new URLSearchParams({ tab: "transactions", page: String(nextPage) });
    if (selectedInstitution !== "all") query.set("institution", selectedInstitution);
    if (selectedAccountId !== "all") query.set("account", selectedAccountId);
    if (selectedTriage !== "all") query.set("triage", selectedTriage);
    if (selectedCategoryPrimary !== "all") query.set("categoryPrimary", selectedCategoryPrimary);
    if (selectedCategoryDetailed !== "all") query.set("categoryDetailed", selectedCategoryDetailed);
    if (selectedTxYear !== "all") query.set("year", selectedTxYear);
    if (selectedTxMonth !== "all") query.set("month", selectedTxMonth);
    if (selectedSearch) query.set("search", selectedSearch);
    return `/?${query.toString()}`;
  };
  const changeTransactionFilter = ({
    institutionId = selectedInstitution,
    accountId = selectedAccountId,
    triage = selectedTriage,
    categoryPrimary = selectedCategoryPrimary,
    categoryDetailed = selectedCategoryDetailed,
    txYear = selectedTxYear,
    txMonth = selectedTxMonth,
    search = selectedSearch,
  }: {
    institutionId?: string;
    accountId?: string;
    triage?: TriageFilter;
    categoryPrimary?: string;
    categoryDetailed?: string;
    txYear?: string;
    txMonth?: string;
    search?: string;
  } = {}) => {
    const query = new URLSearchParams({ tab: "transactions", page: "1" });
    if (institutionId !== "all") query.set("institution", institutionId);
    if (accountId !== "all") query.set("account", accountId);
    if (triage !== "all") query.set("triage", triage);
    if (categoryPrimary !== "all") query.set("categoryPrimary", categoryPrimary);
    if (categoryDetailed !== "all") query.set("categoryDetailed", categoryDetailed);
    if (txYear !== "all") query.set("year", txYear);
    if (txMonth !== "all") query.set("month", txMonth);
    if (search) query.set("search", search);
    window.location.assign(`/?${query.toString()}`);
  };
  const clearSearchDebounce = () => {
    if (searchDebounceRef.current != null) {
      window.clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
  };
  const submitSearch = (value: string) => {
    clearSearchDebounce();
    const trimmed = value.trim();
    if (trimmed === selectedSearch) return;
    changeTransactionFilter({ search: trimmed });
  };
  const handleSearchInput = (value: string) => {
    setSearchDraft(value);
    clearSearchDebounce();
    searchDebounceRef.current = window.setTimeout(() => submitSearch(value), 500);
  };
  useEffect(() => {
    // Switching tabs is a client-side pushState, not a reload, so a pending debounced
    // search (which navigates via window.location.assign) must not fire after the user
    // has already moved off the Transactions tab.
    if (tab !== "transactions") clearSearchDebounce();
  }, [tab]);
  const toggleInstitution = (institution: string) => setExpandedInstitutions((current) => {
    const next = new Set(current);
    if (next.has(institution)) next.delete(institution); else next.add(institution);
    return next;
  });
  useLayoutEffect(() => {
    const detailOpen = Boolean(selectedAccount || selectedTransaction || benefitsDetailOpen);
    if (!detailOpen) {
      document.documentElement.classList.remove("ledger-detail-open");
      focusedDetailFieldRef.current = null;
      return;
    }

    // open* freezes synchronously before setState; benefits overlays rely on this effect.
    if (!document.documentElement.classList.contains("ledger-detail-open")) {
      const scroller = appScrollRef.current;
      coverScrollYRef.current = scroller?.scrollTop ?? 0;
      document.documentElement.classList.add("ledger-detail-open");
    }

    const ensureFocusedFieldVisible = () => {
      const panel = detailSheetRef.current;
      const target = focusedDetailFieldRef.current;
      if (!panel || !target || !panel.contains(target)) return;
      const viewport = window.visualViewport;
      const visibleTop = Math.max(panel.getBoundingClientRect().top, viewport?.offsetTop ?? 0);
      const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const visibleHeight = Math.max(visibleBottom - visibleTop, 120);
      const targetRect = target.getBoundingClientRect();
      const desiredTop = visibleTop + Math.min(72, visibleHeight * 0.18);
      const desiredBottom = visibleBottom - 20;
      if (targetRect.bottom > desiredBottom) {
        panel.scrollTop += targetRect.bottom - desiredBottom;
      }
      const nextRect = target.getBoundingClientRect();
      if (nextRect.top < desiredTop) {
        panel.scrollTop -= desiredTop - nextRect.top;
      }
    };
    const node = detailSheetRef.current;
    if (node) node.scrollTop = 0;
    const onViewportChange = () => {
      ensureFocusedFieldVisible();
    };
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);
    return () => {
      const restoreY = coverScrollYRef.current;
      document.documentElement.classList.remove("ledger-detail-open");
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
      window.requestAnimationFrame(() => {
        if (appScrollRef.current) appScrollRef.current.scrollTop = restoreY;
      });
    };
  }, [selectedAccount, selectedTransaction, benefitsDetailOpen]);

  const focusDetailField = (event: { currentTarget: HTMLElement }) => {
    const target = event.currentTarget;
    focusedDetailFieldRef.current = target;
    const panel = detailSheetRef.current;
    const ensureFocusedFieldVisible = () => {
      if (!panel || focusedDetailFieldRef.current !== target) return;
      const viewport = window.visualViewport;
      const visibleTop = Math.max(panel.getBoundingClientRect().top, viewport?.offsetTop ?? 0);
      const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const visibleHeight = Math.max(visibleBottom - visibleTop, 120);
      const targetRect = target.getBoundingClientRect();
      // Keep the field in the upper part of the space above the keyboard.
      const desiredTop = visibleTop + Math.min(72, visibleHeight * 0.18);
      const desiredBottom = visibleBottom - 24;
      if (targetRect.bottom > desiredBottom) {
        panel.scrollTop += targetRect.bottom - desiredBottom;
      }
      const nextRect = target.getBoundingClientRect();
      if (nextRect.top < desiredTop) {
        panel.scrollTop -= desiredTop - nextRect.top;
      }
    };
    window.requestAnimationFrame(ensureFocusedFieldVisible);
    // iOS keyboard animates in; re-check a few times as visualViewport shrinks.
    window.setTimeout(ensureFocusedFieldVisible, 50);
    window.setTimeout(ensureFocusedFieldVisible, 180);
    window.setTimeout(ensureFocusedFieldVisible, 350);
    window.setTimeout(ensureFocusedFieldVisible, 550);
  };
  const blurDetailField = (event: { currentTarget: HTMLElement }) => {
    if (focusedDetailFieldRef.current === event.currentTarget) {
      focusedDetailFieldRef.current = null;
    }
  };
  const blurActiveDetailField = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && detailSheetRef.current?.contains(active)) {
      active.blur();
    }
    focusedDetailFieldRef.current = null;
  };

  const freezeBodyForDetail = () => {
    if (document.documentElement.classList.contains("ledger-detail-open")) return;
    coverScrollYRef.current = appScrollRef.current?.scrollTop ?? 0;
    document.documentElement.classList.add("ledger-detail-open");
  };
  const pushDetailHistory = (viewKey: string) => {
    // Bypass Next's patched history (`__NA`) so back does not ACTION_RESTORE/refetch.
    // Do NOT replaceState first — that can wipe iOS's previous-page screenshot (blank peek
    // when the list is scrolled). Push a distinct URL so Safari can snapshot the list page.
    const url = new URL(window.location.href);
    url.searchParams.set("view", viewKey);
    const proto = History.prototype;
    proto.pushState.call(
      window.history,
      { __NA: true, ledgerDetail: true },
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    detailHistoryPushedRef.current = true;
  };
  const closeDetailViaHistoryOrState = (clear: () => void) => {
    if (detailHistoryPushedRef.current) {
      window.history.back();
      return;
    }
    clear();
  };
  const openAccount = (account: Account) => {
    pushDetailHistory(`account-${account.accountId}`);
    freezeBodyForDetail();
    setSelectedAccount(account);
    setDisplayMaskDraft(account.displayMask ?? "");
    setStatus(null);
  };
  const closeAccount = () => {
    blurActiveDetailField();
    closeDetailViaHistoryOrState(() => {
      setSelectedAccount(null);
      setDisplayMaskDraft("");
    });
  };
  const closeTransaction = () => {
    blurActiveDetailField();
    flushDetailNote();
    closeDetailViaHistoryOrState(() => {
      setSelectedTransaction(null);
      setEditingNoteId(null);
      setNoteDraft("");
    });
  };
  const openTransaction = (transaction: Transaction) => {
    const latest = transactionRows.find((row) => row.transactionId === transaction.transactionId) ?? transaction;
    pushDetailHistory(`tx-${latest.transactionId}`);
    freezeBodyForDetail();
    setSelectedTransaction(latest);
    setNoteDraft(latest.note ?? "");
    setEditingNoteId(null);
    setStatus(null);
  };

  const handleTransactionRowClick = (transaction: Transaction, isEditing: boolean) => {
    if (isEditing) {
      void saveTransactionNote(transaction.transactionId, noteDraftRef.current);
      return;
    }
    openTransaction(transaction);
  };
  const handleNoteInputBlur = (transaction: Transaction) => {
    window.setTimeout(() => {
      if (suppressNoteBlurSaveRef.current) {
        suppressNoteBlurSaveRef.current = false;
        return;
      }
      if (editingNoteIdRef.current !== transaction.transactionId) return;
      const draft = noteDraftRef.current;
      if (draft.trim() === (transaction.note ?? "")) {
        setEditingNoteId(null);
        return;
      }
      void saveTransactionNote(transaction.transactionId, draft);
    }, 0);
  };
  const patchTransactionLocally = (
    transactionId: string,
    patch: { note?: string | null; triage?: TriageStatus; categoryPrimary?: string | null; categoryDetailed?: string | null },
  ) => {
    const current = transactionPatchesRef.current.get(transactionId) ?? {};
    transactionPatchesRef.current.set(transactionId, { ...current, ...patch });
    setTransactionRows((rows) => rows.map((transaction) => (
      transaction.transactionId === transactionId ? { ...transaction, ...patch } : transaction
    )));
    setSelectedTransaction((selected) => (
      selected?.transactionId === transactionId ? { ...selected, ...patch } : selected
    ));
  };
  const applyNoteLocally = (transactionId: string, note: string | null) => {
    patchTransactionLocally(transactionId, { note });
  };
  const saveTransactionNote = async (transactionId: string, note: string | null) => {
    setSavingNote(true);
    setStatus(null);
    applyNoteLocally(transactionId, note);
    try {
      const response = await fetch("/api/transactions/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId, note }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to save note");
      applyNoteLocally(transactionId, payload.note ?? null);
      setNoteDraft(payload.note ?? "");
      setEditingNoteId(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save note");
    } finally {
      setSavingNote(false);
    }
  };
  const applyTriageLocally = (transactionId: string, triage: TriageStatus) => {
    patchTransactionLocally(transactionId, { triage });
  };
  const saveTransactionTriage = async (transactionId: string, triage: TriageStatus) => {
    const current = transactionRows.find((row) => row.transactionId === transactionId);
    if (current && normalizeTriage(current.triage) === triage) return;
    const previous = normalizeTriage(current?.triage);
    applyTriageLocally(transactionId, triage);
    try {
      const response = await fetch("/api/transactions/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId, triage }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to save triage");
      const next = normalizeTriage(payload.triage);
      applyTriageLocally(transactionId, next);
      if (selectedTriage !== "all" && selectedTriage !== next) {
        setTransactionRows((rows) => rows.filter((row) => row.transactionId !== transactionId));
      }
    } catch (error) {
      applyTriageLocally(transactionId, previous);
      setStatus(error instanceof Error ? error.message : "Unable to save triage");
    }
  };
  const focusListNoteInput = () => {
    const input = listNoteInputRef.current;
    if (!input) return false;
    pendingListNoteFocusRef.current = false;
    input.focus({ preventScroll: true });
    const len = input.value.length;
    try {
      input.setSelectionRange(len, len);
    } catch {
      // Some browsers reject setSelectionRange on certain input types.
    }
    input.scrollIntoView({ block: "nearest", inline: "nearest" });
    return document.activeElement === input;
  };
  const startListNoteEdit = (transaction: Transaction, options?: { focus?: boolean }) => {
    const shouldFocus = options?.focus !== false;
    pendingListNoteFocusRef.current = shouldFocus;
    flushSync(() => {
      setEditingNoteId(transaction.transactionId);
      setNoteDraft(transaction.note ?? "");
    });
    if (shouldFocus) focusListNoteInput();
  };
  const applyDisplayMaskLocally = (accountId: string, displayMask: string | null) => {
    setOrderedAccounts((current) => current.map((account) => (
      account.accountId === accountId ? { ...account, displayMask } : account
    )));
    setSelectedAccount((current) => (
      current?.accountId === accountId ? { ...current, displayMask } : current
    ));
    setDisplayMaskDraft(displayMask ?? "");
  };
  const saveDisplayMask = async (displayMask: string | null) => {
    if (!selectedAccount) return;
    setSavingDisplayMask(true);
    setStatus(null);
    try {
      const response = await fetch("/api/accounts/display-mask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: selectedAccount.accountId, displayMask }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to save last 5 digits");
      applyDisplayMaskLocally(selectedAccount.accountId, payload.displayMask ?? null);
      setStatus(displayMask ? "Saved last 5 digits." : "Cleared last 5 digits.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save last 5 digits");
    } finally {
      setSavingDisplayMask(false);
    }
  };
  const goToTab = (nextTab: "accounts" | "transactions" | "benefits" | "insights" | "rewards") => {
    if (nextTab === tab && !selectedAccount && !selectedTransaction && !benefitsDetailOpen) return;
    blurActiveDetailField();
    if (selectedTransaction) flushDetailNote();
    setSelectedAccount(null);
    setSelectedTransaction(null);
    setDisplayMaskDraft("");
    setEditingNoteId(null);
    setNoteDraft("");
    setBenefitsDetailOpen(false);
    setTab(nextTab);

    const query = new URLSearchParams({ tab: nextTab });
    if (nextTab === "transactions") {
      query.set("page", String(page));
      if (selectedInstitution !== "all") query.set("institution", selectedInstitution);
      if (selectedAccountId !== "all") query.set("account", selectedAccountId);
      if (selectedTriage !== "all") query.set("triage", selectedTriage);
      if (selectedCategoryPrimary !== "all") query.set("categoryPrimary", selectedCategoryPrimary);
      if (selectedCategoryDetailed !== "all") query.set("categoryDetailed", selectedCategoryDetailed);
      if (selectedTxYear !== "all") query.set("year", selectedTxYear);
      if (selectedTxMonth !== "all") query.set("month", selectedTxMonth);
      if (selectedSearch) query.set("search", selectedSearch);
    }
    const url = `/?${query.toString()}`;
    const proto = History.prototype;
    if (detailHistoryPushedRef.current || benefitsDetailHistoryRef.current) {
      detailHistoryPushedRef.current = false;
      benefitsDetailHistoryRef.current = false;
      proto.replaceState.call(window.history, { ledgerTab: nextTab }, "", url);
    } else {
      proto.pushState.call(window.history, { ledgerTab: nextTab }, "", url);
    }
  };

  const selectedAccountArt = selectedAccount ? resolveCardArt(selectedAccount) : null;
  const selectedAccountInstitutionIcon = selectedAccount
    ? institutionIconSrc(selectedAccount.institutionName, selectedAccount.institutionLogo)
    : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">L</span><h1>{pageTitle}</h1></div>
        <OwnerMenu viewerEmail={viewerEmail} deployVersion={deployVersion} />
      </header>

      <div className="app-scroll" ref={appScrollRef}>
      {status && <div className="status-banner" role="status">{status}</div>}
      {databasePending && <div className="status-banner warning">The database is being prepared.</div>}

      {tab === "accounts" && selectedAccount && (
        <section ref={detailSheetRef} className="detail-panel" aria-labelledby="account-detail-title">
          <div className="account-detail detail-panel-inner">
          <div className="section-heading">
            <button className="button ghost small" type="button" onClick={closeAccount}>
              <ArrowLeft aria-hidden="true" /> Accounts
            </button>
          </div>

          <div className="account-detail-header">
            {selectedAccountArt ? (
              <img className="account-detail-art" src={selectedAccountArt.src} alt="" />
            ) : selectedAccountInstitutionIcon ? (
              <div className={resolveInstitutionIcon(selectedAccount.institutionName) ? "account-detail-thumb static-icon" : "account-detail-thumb"}>
                <img src={selectedAccountInstitutionIcon} alt="" />
              </div>
            ) : (
              <div
                className="account-detail-thumb monogram"
                style={selectedAccount.institutionPrimaryColor ? { backgroundColor: selectedAccount.institutionPrimaryColor } : undefined}
              >
                {initials(selectedAccount.institutionName ?? selectedAccount.name)}
              </div>
            )}
            <div className="account-detail-copy">
              <p className="section-kicker">ACCOUNT</p>
              <h2 id="account-detail-title">{selectedAccount.name}</h2>
              <p>{selectedAccount.institutionName ?? "Institution"} · {formatAccountMask(selectedAccount)}</p>
            </div>
          </div>

          <div className="account-detail-balance" aria-label="Current balance">
            <span>Current balance</span>
            <strong>{money(selectedAccount.currentBalanceMilliunits, selectedAccount.isoCurrencyCode ?? "USD")}</strong>
          </div>

          {selectedAccount.type === "credit" && isAmexInstitution(selectedAccount.institutionName) && (
            <div className="account-detail-panel display-mask-editor">
              <label>
                <span>Last 5 digits</span>
                <input
                  value={displayMaskDraft}
                  onChange={(event) => setDisplayMaskDraft(event.target.value.replace(/\D/g, "").slice(0, 5))}
                  onFocus={focusDetailField}
                  onBlur={blurDetailField}
                  inputMode="numeric"
                  maxLength={5}
                  placeholder={selectedAccount.mask ? `${selectedAccount.mask}x` : "12345"}
                  aria-label="Amex last 5 digits"
                />
              </label>
              <div className="display-mask-actions">
                <button
                  className="button primary small"
                  type="button"
                  disabled={savingDisplayMask || !/^\d{5}$/.test(displayMaskDraft) || displayMaskDraft === (selectedAccount.displayMask ?? "")}
                  onClick={() => saveDisplayMask(displayMaskDraft)}
                >
                  {savingDisplayMask ? "Saving…" : "Save"}
                </button>
                <button
                  className="button ghost small"
                  type="button"
                  disabled={savingDisplayMask || !selectedAccount.displayMask}
                  onClick={() => saveDisplayMask(null)}
                >
                  Clear
                </button>
              </div>
              <p>Plaid only provides the last 4 digits. Add the 5th digit yourself to tell cards apart.</p>
            </div>
          )}

          <dl className="account-detail-panel account-detail-fields">
            <div><dt>Account type</dt><dd>{accountKind(selectedAccount)}</dd></div>
            <div><dt>Subtype</dt><dd>{selectedAccount.subtype ?? "—"}</dd></div>
            <div><dt>Available balance</dt><dd>{money(selectedAccount.availableBalanceMilliunits, selectedAccount.isoCurrencyCode ?? "USD")}</dd></div>
            <div><dt>Currency</dt><dd>{selectedAccount.isoCurrencyCode ?? "USD"}</dd></div>
            <div><dt>Official name</dt><dd>{selectedAccount.officialName ?? selectedAccount.name}</dd></div>
            <div><dt>Last updated</dt><dd>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selectedAccount.updatedAt))}</dd></div>
          </dl>
          </div>
        </section>
      )}

      {tab === "accounts" && (
        <section
          className={selectedAccount ? "tab-content is-covered" : "tab-content"}
          aria-hidden={Boolean(selectedAccount)}
        >
          <div className="balance-summary" aria-label="Account balance summary">
            <div><span>Cash</span><strong>{money(accountSummary.cash)}</strong></div>
            <div><span>Invest</span><strong>{money(accountSummary.investments)}</strong></div>
            <div><span>Credit</span><strong>{money(accountSummary.credit)}</strong></div>
          </div>
          <div className="section-heading accounts-heading">
            <h2>{accounts.length} accounts <span className="accounts-heading-sep" aria-hidden="true">|</span> {groupedAccounts.length} bank{groupedAccounts.length === 1 ? "" : "s"}</h2>
            <div className="accounts-toolbar">
              <button className="button ghost small" type="button" onClick={sync} disabled={busy || institutions.length === 0}>
                <RefreshCw aria-hidden="true" /> Sync
              </button>
              <button className="button primary small" type="button" onClick={connectBank} disabled={busy || !plaidReady || !linkToken}>
                <Plus aria-hidden="true" /> Add bank
              </button>
            </div>
          </div>
          {groupedAccounts.length === 0 ? <Empty title="No accounts yet" copy="Add a bank to start importing accounts and transactions." /> : <DndContext sensors={sensors} onDragEnd={reorderAccounts}>{groupedAccounts.map(({ institution, accounts: rows }) => {
            const buckets = (["credit", "cash", "investment", "other"] as const)
              .map((bucket) => ({ bucket, accounts: rows.filter((account) => accountBucket(account) === bucket) }))
              .filter((group) => group.accounts.length > 0);
            const summaryParts = buckets.map((group) => {
              if (group.bucket === "credit") return `${group.accounts.length} credit`;
              if (group.bucket === "cash") return `${group.accounts.length} cash`;
              if (group.bucket === "investment") return `${group.accounts.length} invest`;
              return `${group.accounts.length} other`;
            });
            const icon = institutionIconSrc(institution.institutionName, institution.institutionLogo);
            const groupKey = institution.itemId;
            const isActive = institution.status.toLowerCase() === "active";
            return (
            <section className="institution-group" key={groupKey}>
              <div className="institution-heading-row">
                <button className="institution-heading" type="button" aria-expanded={expandedInstitutions.has(groupKey)} onClick={() => toggleInstitution(groupKey)}>
                  <div className={icon && resolveInstitutionIcon(institution.institutionName) ? "institution-monogram static-icon" : "institution-monogram"} style={!icon && institution.institutionPrimaryColor ? { backgroundColor: institution.institutionPrimaryColor } : undefined}>{icon ? <img src={icon} alt="" /> : initials(institution.institutionName)}</div>
                  <div className="institution-copy">
                    <h3>
                      {institution.institutionName}
                      <span className="institution-account-count">
                        {summaryParts.length > 0 ? ` · ${summaryParts.join(" · ")}` : " · No accounts yet"}
                      </span>
                    </h3>
                    <p className="institution-meta-line">
                      <span
                        className={isActive ? "institution-status-dot ok" : "institution-status-dot bad"}
                        aria-label={institution.status}
                        title={institution.status}
                      />
                      <span>synced {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(institution.updatedAt))}</span>
                    </p>
                  </div>
                </button>
                <button
                  className={reconnectingItemId === institution.itemId ? "institution-reconnect is-busy" : "institution-reconnect"}
                  type="button"
                  onClick={() => reconnectInstitution(institution.itemId)}
                  disabled={busy}
                  aria-label={reconnectingItemId === institution.itemId ? "Reconnecting" : `Reconnect ${institution.institutionName}`}
                  title="Reconnect"
                >
                  <Link2 aria-hidden="true" />
                </button>
              </div>
              {expandedInstitutions.has(groupKey) && (
                rows.length === 0
                  ? <div className="institution-empty">No accounts synced for this bank yet.</div>
                  : <SortableContext items={rows.map((account) => account.accountId)} strategy={verticalListSortingStrategy}>
                    <div className="account-grid">
                      {buckets.map((group) => (
                        <Fragment key={group.bucket}>
                          <h4 className="account-group-label">{ACCOUNT_BUCKET_LABELS[group.bucket]}</h4>
                          {group.accounts.map((account) => <SortableAccountCard key={account.accountId} account={account} institution={institution.institutionName} onOpen={openAccount} />)}
                        </Fragment>
                      ))}
                    </div>
                  </SortableContext>
              )}
            </section>
            );
          })}</DndContext>}
        </section>
      )}

      {tab === "transactions" && selectedTransaction && (
        <section ref={detailSheetRef} className="detail-panel" aria-labelledby="transaction-detail-title">
          <div className="account-detail detail-panel-inner">
          <div className="section-heading">
            <button className="button ghost small" type="button" onClick={closeTransaction}>
              <ArrowLeft aria-hidden="true" /> Transactions
            </button>
          </div>

          <div className="account-detail-header">
            <div className="account-detail-thumb">
              {selectedTransaction.logoUrl
                ? <img src={selectedTransaction.logoUrl} alt="" />
                : initials(selectedTransaction.merchantName ?? selectedTransaction.name)}
            </div>
            <div className="account-detail-copy">
              <p className="section-kicker">TRANSACTION</p>
              <h2 id="transaction-detail-title">{selectedTransaction.merchantName ?? selectedTransaction.name}</h2>
              <p>{transactionAccountLine(selectedTransaction)}</p>
            </div>
          </div>

          <div className={`account-detail-balance${selectedTransaction.amountMilliunits < 0 ? " credit" : ""}`} aria-label="Transaction amount">
            <span>{selectedTransaction.pending ? "Pending amount" : "Amount"}</span>
            <strong>
              {selectedTransaction.amountMilliunits < 0 ? "+" : "−"}
              {money(Math.abs(selectedTransaction.amountMilliunits), selectedTransaction.isoCurrencyCode ?? "USD")}
            </strong>
          </div>

          <dl className="account-detail-panel account-detail-fields">
            <div className="detail-interactive-row">
              <dt>Triage</dt>
              <dd className="detail-triage-dd">
                <TriageSlider
                  value={normalizeTriage(selectedTransaction.triage)}
                  onChange={(triage) => saveTransactionTriage(selectedTransaction.transactionId, triage)}
                />
              </dd>
            </div>
            <div className="detail-interactive-row detail-note-row">
              <dt>Note</dt>
              <dd className="detail-note-dd">
                {editingNoteId === selectedTransaction.transactionId ? (
                  <textarea
                    ref={detailNoteInputRef}
                    className="detail-note-input"
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value.slice(0, 500))}
                    onFocus={focusDetailField}
                    onBlur={(event) => {
                      blurDetailField(event);
                      const nextNote = noteDraftRef.current.trim() ? noteDraftRef.current.trim() : null;
                      if (nextNote !== (selectedTransaction.note ?? null)) {
                        void saveTransactionNote(selectedTransaction.transactionId, nextNote);
                      } else {
                        setEditingNoteId(null);
                      }
                    }}
                    rows={2}
                    maxLength={500}
                    placeholder="Add a personal note"
                    aria-label="Transaction note"
                    disabled={savingNote}
                  />
                ) : (
                  <button
                    className={selectedTransaction.note ? "detail-note-trigger has-note" : "detail-note-trigger"}
                    type="button"
                    aria-label={selectedTransaction.note ? "Edit note" : "Add note"}
                    onClick={() => {
                      setNoteDraft(selectedTransaction.note ?? "");
                      flushSync(() => {
                        setEditingNoteId(selectedTransaction.transactionId);
                      });
                      detailNoteInputRef.current?.focus();
                    }}
                  >
                    <StickyNote aria-hidden="true" />
                    <span>{selectedTransaction.note?.trim() || "Add note"}</span>
                  </button>
                )}
              </dd>
            </div>
            <div><dt>Status</dt><dd>{selectedTransaction.pending ? "Pending" : "Posted"}</dd></div>
            <div><dt>Currency</dt><dd>{dash(selectedTransaction.isoCurrencyCode)}</dd></div>
            <div><dt>Date</dt><dd>{formatDate(selectedTransaction.date)}</dd></div>
            <div><dt>Authorized date</dt><dd>{selectedTransaction.authorizedDate ? formatDate(selectedTransaction.authorizedDate) : "—"}</dd></div>
            <div><dt>Institution</dt><dd>{dash(selectedTransaction.institutionName)}</dd></div>
            <div><dt>Account</dt><dd>{transactionAccountLine(selectedTransaction)}</dd></div>
            <div><dt>Account name</dt><dd>{dash(selectedTransaction.accountName)}</dd></div>
            <div><dt>Official name</dt><dd>{dash(selectedTransaction.accountOfficialName)}</dd></div>
            <div><dt>Name</dt><dd>{dash(selectedTransaction.name)}</dd></div>
            <div><dt>Merchant</dt><dd>{dash(selectedTransaction.merchantName)}</dd></div>
            <div><dt>Original description</dt><dd>{dash(selectedTransaction.originalDescription)}</dd></div>
            <div>
              <dt>Category</dt>
              <dd>
                <CategoryEditor
                  transactionId={selectedTransaction.transactionId}
                  transactionName={selectedTransaction.name}
                  categoryPrimary={selectedTransaction.categoryPrimary}
                  onSaved={(transactionId, categoryPrimary) => patchTransactionLocally(transactionId, { categoryPrimary, categoryDetailed: null })}
                  onBatchApplied={(transactionIds, categoryPrimary) => {
                    transactionIds.forEach((id) => patchTransactionLocally(id, { categoryPrimary, categoryDetailed: null }));
                  }}
                />
              </dd>
            </div>
            <div><dt>Category detail</dt><dd>{dash(formatCategory(selectedTransaction.categoryDetailed))}</dd></div>
            <div><dt>Payment channel</dt><dd>{dash(selectedTransaction.paymentChannel)}</dd></div>
            <div>
              <dt>Website</dt>
              <dd>
                {selectedTransaction.website
                  ? <a href={selectedTransaction.website.startsWith("http") ? selectedTransaction.website : `https://${selectedTransaction.website}`} target="_blank" rel="noreferrer">{selectedTransaction.website}</a>
                  : "—"}
              </dd>
            </div>
            <div><dt>Transaction ID</dt><dd className="mono-id">{selectedTransaction.transactionId}</dd></div>
            <div><dt>Account ID</dt><dd className="mono-id">{selectedTransaction.accountId}</dd></div>
            <div><dt>Last updated</dt><dd>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selectedTransaction.updatedAt))}</dd></div>
          </dl>
          </div>
        </section>
      )}

      {tab === "transactions" && (
        <section
          className={selectedTransaction ? "tab-content is-covered" : "tab-content"}
          aria-hidden={Boolean(selectedTransaction)}
        >
          <div className="section-heading"><h2>Recent activity</h2><p>{pageStart.toLocaleString()}–{pageEnd.toLocaleString()} of {totalTransactions.toLocaleString()}</p></div>
          <div className="transaction-search-field">
            <Search aria-hidden="true" />
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              placeholder="Search transactions"
              aria-label="Search transactions by name"
              value={searchDraft}
              onChange={(event) => handleSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitSearch(searchDraft);
              }}
              onBlur={() => submitSearch(searchDraft)}
            />
            {searchDraft && (
              <button
                type="button"
                className="transaction-search-clear"
                aria-label="Clear search"
                onClick={() => {
                  setSearchDraft("");
                  submitSearch("");
                }}
              >
                <X aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="transaction-filters">
            <div className="transaction-filter-field">
              <span>Year</span>
              <SimpleFilterSelect
                value={selectedTxYear}
                ariaLabel="Year"
                options={[
                  { value: "all", label: "All years" },
                  ...[...new Set(
                    selectedTxYear !== "all"
                      ? [selectedTxYear, ...transactionYearOptions]
                      : transactionYearOptions,
                  )].map((year) => ({ value: year, label: year })),
                ]}
                onChange={(txYear) => changeTransactionFilter({ txYear })}
              />
            </div>
            <div className="transaction-filter-field">
              <span>Month</span>
              <SimpleFilterSelect
                value={selectedTxMonth}
                ariaLabel="Month"
                options={[
                  { value: "all", label: "All months" },
                  ...TX_MONTH_OPTIONS,
                ]}
                onChange={(txMonth) => changeTransactionFilter({ txMonth })}
              />
            </div>
            <div className="transaction-filter-field">
              <span>Bank</span>
              <BankFilterSelect
                value={selectedInstitution}
                institutions={institutions}
                onChange={(institutionId) => changeTransactionFilter({ institutionId, accountId: "all" })}
              />
            </div>
            <div className="transaction-filter-field">
              <span>Account</span>
              <AccountFilterSelect
                value={selectedAccountId}
                groups={accountFilterGroups}
                onChange={(accountId) => changeTransactionFilter({ accountId })}
              />
            </div>
            <div className="transaction-filter-field">
              <span>Category</span>
              <CategoryPrimaryFilterSelect
                value={selectedCategoryPrimary}
                options={categoryPrimaryOptions}
                onChange={(categoryPrimary) => {
                  let categoryDetailed = selectedCategoryDetailed;
                  if (categoryPrimary === "uncategorized") {
                    categoryDetailed = "all";
                  } else if (
                    categoryDetailed !== "all"
                    && categoryDetailed !== "uncategorized"
                    && categoryPrimary !== "all"
                    && !categoryDetailed.startsWith(`${categoryPrimary}_`)
                  ) {
                    categoryDetailed = "all";
                  }
                  changeTransactionFilter({ categoryPrimary, categoryDetailed });
                }}
              />
            </div>
            <div className="transaction-filter-field">
              <span>Detail</span>
              <CategoryDetailedFilterSelect
                value={selectedCategoryDetailed}
                primary={selectedCategoryPrimary}
                options={categoryDetailedOptions}
                disabled={selectedCategoryPrimary === "uncategorized"}
                onChange={(categoryDetailed) => {
                  if (categoryDetailed === "all" || categoryDetailed === "uncategorized") {
                    changeTransactionFilter({ categoryDetailed });
                    return;
                  }
                  const matchingPrimary = categoryOptions.find((row) => row.detailed === categoryDetailed)?.primary;
                  changeTransactionFilter({
                    categoryPrimary: matchingPrimary ?? selectedCategoryPrimary,
                    categoryDetailed,
                  });
                }}
              />
            </div>
            <div className="transaction-filter-field triage-filter-field">
              <span>Triage</span>
              <TriageFilterSlider
                value={selectedTriage}
                onChange={(triage) => changeTransactionFilter({ triage })}
              />
            </div>
          </div>
          {transactionRows.length === 0 ? (
            selectedTriage === "all"
              && selectedInstitution === "all"
              && selectedAccountId === "all"
              && selectedCategoryPrimary === "all"
              && selectedCategoryDetailed === "all"
              && selectedTxYear === "all"
              && selectedTxMonth === "all"
              && !selectedSearch
              ? <Empty title="No transactions yet" copy="Connect an institution and sync it to begin your ledger." />
              : <div className="transaction-empty-filter">No matching transactions</div>
          ) : <div className="transaction-list">
            {transactionRows.map((transaction, index) => {
              const title = transaction.merchantName ?? transaction.name;
              const startsDate = index === 0 || transactionRows[index - 1].date !== transaction.date;
              const editing = editingNoteId === transaction.transactionId;
              const triage = normalizeTriage(transaction.triage);
              return <Fragment key={transaction.transactionId}>
                {startsDate && <h3 className="transaction-date-heading">{formatDateGroup(transaction.date)}</h3>}
                <SwipeableTransactionRow
                  triage={triage}
                  noteOpen={Boolean(transaction.note || editing)}
                  onTriage={(next) => saveTransactionTriage(transaction.transactionId, next)}
                  onLongPress={() => startListNoteEdit(transaction, { focus: false })}
                  onLongPressEnd={() => {
                    pendingListNoteFocusRef.current = true;
                    focusListNoteInput();
                  }}
                  onOpenTap={() => handleTransactionRowClick(transaction, editing)}
                >
                  <div className="transaction-row-main">
                    <button
                      className="transaction-row-open"
                      type="button"
                      onMouseDown={() => {
                        if (editing) suppressNoteBlurSaveRef.current = true;
                      }}
                      onClick={() => handleTransactionRowClick(transaction, editing)}
                    >
                      <div className="merchant-avatar">{transaction.logoUrl ? <img src={transaction.logoUrl} alt="" /> : initials(title)}</div>
                      <div className="transaction-main">
                        <div className="transaction-title-line">
                          {triage === "recognized" && (
                            <span className="transaction-triage-mark recognized" title="Recognized" aria-label="Recognized">
                              <Check aria-hidden="true" />
                            </span>
                          )}
                          {triage === "questioned" && (
                            <span className="transaction-triage-mark questioned" title="Questioned" aria-label="Questioned">
                              <HelpCircle aria-hidden="true" />
                            </span>
                          )}
                          <h3>{title}</h3>
                          {transaction.pending && <span className="pending-badge">Pending</span>}
                        </div>
                        <p className="transaction-account-line">{transactionAccountLine(transaction)}</p>
                        {categoryBadgeLabel(transaction.categoryPrimary) && (
                          <span className="transaction-category-badge">{categoryBadgeLabel(transaction.categoryPrimary)}</span>
                        )}

                      </div>
                      <strong className={transaction.amountMilliunits < 0 ? "amount credit" : "amount"}>
                        {transaction.amountMilliunits < 0 ? "+" : "−"}
                        {money(Math.abs(transaction.amountMilliunits), transaction.isoCurrencyCode ?? "USD")}
                      </strong>
                    </button>
                  </div>
                  {(transaction.note || editing) && (
                    <div className="transaction-note-row">
                      <div className="transaction-note-slot">
                        {editing ? (
                          <div className="transaction-note-inline">
                            <input
                              ref={listNoteInputRef}
                              inputMode="text"
                              enterKeyHint="done"
                              value={noteDraft}
                              onChange={(event) => setNoteDraft(event.target.value.slice(0, 500))}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void saveTransactionNote(transaction.transactionId, noteDraft);
                                }
                                if (event.key === "Escape") {
                                  setEditingNoteId(null);
                                  setNoteDraft("");
                                }
                              }}
                              onBlur={() => handleNoteInputBlur(transaction)}
                              disabled={savingNote}
                              maxLength={500}
                              placeholder="Add a note"
                              aria-label="Edit transaction note"
                            />
                          </div>
                        ) : (
                          <button
                            className="transaction-note-text"
                            type="button"
                            onClick={() => startListNoteEdit(transaction)}
                          >
                            {transaction.note}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </SwipeableTransactionRow>
              </Fragment>;
            })}
          </div>}
          {totalPages > 1 && <nav className="pagination" aria-label="Transaction pages">
            <a className={page <= 1 ? "page-link disabled" : "page-link"} aria-disabled={page <= 1} href={transactionHref(Math.max(1, page - 1))}>← Previous</a>
            <span>Page <strong>{page}</strong> of {totalPages}</span>
            <a className={page >= totalPages ? "page-link disabled" : "page-link"} aria-disabled={page >= totalPages} href={transactionHref(Math.min(totalPages, page + 1))}>Next →</a>
          </nav>}
        </section>
      )}

      <BenefitsPanel
        active={tab === "benefits"}
        creditAccounts={creditAccounts}
        initialBundle={benefitsBundle}
        onDetailHistoryChange={(active) => {
          benefitsDetailHistoryRef.current = active;
          if (active) freezeBodyForDetail();
          setBenefitsDetailOpen(active);
        }}
      />

      {tab === "insights" && <InsightsPanel />}
      {tab === "rewards" && <RewardsPanel />}
      </div>

      <nav className="bottom-tabs" aria-label="Ledger sections">
        <button className={tab === "accounts" ? "bottom-tab active" : "bottom-tab"} type="button" onClick={() => goToTab("accounts")} aria-label="Accounts" title="Accounts"><CreditCard aria-hidden="true" /></button>
        <button className={tab === "transactions" ? "bottom-tab active" : "bottom-tab"} type="button" onClick={() => goToTab("transactions")} aria-label="Transactions" title="Transactions"><List aria-hidden="true" /></button>
        <button className={tab === "insights" ? "bottom-tab active" : "bottom-tab"} type="button" onClick={() => goToTab("insights")} aria-label="Spending" title="Spending"><PieChart aria-hidden="true" /></button>
        <button className={tab === "benefits" ? "bottom-tab active" : "bottom-tab"} type="button" onClick={() => goToTab("benefits")} aria-label="Benefits" title="Benefits"><Gift aria-hidden="true" /></button>
        <button className={tab === "rewards" ? "bottom-tab active" : "bottom-tab"} type="button" onClick={() => goToTab("rewards")} aria-label="Rewards" title="Rewards"><Coins aria-hidden="true" /></button>
      </nav>
    </main>
  );
}

function Empty({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><div className="empty-icon">↗</div><h3>{title}</h3><p>{copy}</p></div>;
}

const TRIAGE_OPTIONS: { value: TriageStatus; label: string; Icon: typeof Circle }[] = [
  { value: "untriaged", label: "Untriaged", Icon: Circle },
  { value: "recognized", label: "Recognized", Icon: Check },
  { value: "questioned", label: "Questioned", Icon: HelpCircle },
];

const TRIAGE_FILTER_OPTIONS: { value: TriageFilter; label: string; Icon: typeof Circle }[] = [
  { value: "all", label: "All", Icon: LayoutGrid },
  ...TRIAGE_OPTIONS,
];

const TX_MONTH_OPTIONS = [
  { value: "01", label: "Jan" },
  { value: "02", label: "Feb" },
  { value: "03", label: "Mar" },
  { value: "04", label: "Apr" },
  { value: "05", label: "May" },
  { value: "06", label: "Jun" },
  { value: "07", label: "Jul" },
  { value: "08", label: "Aug" },
  { value: "09", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
] as const;

function TriageSlider({
  value,
  onChange,
}: {
  value: TriageStatus;
  onChange: (triage: TriageStatus) => void;
}) {
  const index = Math.max(0, TRIAGE_OPTIONS.findIndex((option) => option.value === value));
  return (
    <div className="triage-slider" data-value={value} role="radiogroup" aria-label="Triage status">
      <div className="triage-slider-track" aria-hidden="true">
        <div className="triage-slider-thumb" style={{ transform: `translateX(${index * 100}%)` }} />
      </div>
      {TRIAGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? `triage-slider-option active triage-${option.value}` : `triage-slider-option triage-${option.value}`}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => onChange(option.value)}
        >
          <option.Icon aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function TriageFilterSlider({
  value,
  onChange,
}: {
  value: TriageFilter;
  onChange: (triage: TriageFilter) => void;
}) {
  const index = Math.max(0, TRIAGE_FILTER_OPTIONS.findIndex((option) => option.value === value));
  return (
    <div className="triage-slider triage-filter-slider" data-value={value} role="radiogroup" aria-label="Triage filter">
      <div className="triage-slider-track" aria-hidden="true">
        <div className="triage-slider-thumb" style={{ transform: `translateX(${index * 100}%)` }} />
      </div>
      {TRIAGE_FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? `triage-slider-option active triage-${option.value}` : `triage-slider-option triage-${option.value}`}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => onChange(option.value)}
        >
          <option.Icon aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function SwipeableTransactionRow({
  triage,
  noteOpen,
  onTriage,
  onLongPress,
  onLongPressEnd,
  onOpenTap,
  children,
}: {
  triage: TriageStatus;
  noteOpen: boolean;
  onTriage: (triage: TriageStatus) => void;
  onLongPress?: () => void;
  onLongPressEnd?: () => void;
  onOpenTap?: () => void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const rowRef = useRef<HTMLElement | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const offsetRef = useRef(0);
  const axisRef = useRef<"pending" | "h" | "v" | null>(null);
  const draggedRef = useRef(false);
  const longPressFiredRef = useRef(false);
  const tapConsumedRef = useRef(false);
  const downOnOpenTargetRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const threshold = 72;
  const maxSwipe = 96;
  const longPressMs = 480;

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || !onLongPress) return;
    const blockSelect = (event: Event) => {
      event.preventDefault();
    };
    row.addEventListener("selectstart", blockSelect);
    return () => row.removeEventListener("selectstart", blockSelect);
  }, [onLongPress]);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const reset = () => {
    clearLongPressTimer();
    axisRef.current = null;
    activePointerRef.current = null;
    setSwiping(false);
    setOffset(0);
  };

  const commit = () => {
    const current = offsetRef.current;
    if (current >= threshold) onTriage("recognized");
    else if (current <= -threshold) onTriage("questioned");
    reset();
  };

  const finishLongPress = () => {
    longPressFiredRef.current = false;
    reset();
    // Focus during pointerup so mobile browsers treat it as a user gesture and open the keyboard.
    onLongPressEnd?.();
  };

  return (
    <article
      ref={rowRef}
      className={[
        "transaction-row",
        noteOpen ? "has-note" : "",
        triage === "recognized" ? "triage-recognized" : "",
        triage === "questioned" ? "triage-questioned" : "",
        swiping ? "swiping" : "",
      ].filter(Boolean).join(" ")}
      onContextMenu={(event) => {
        if (onLongPress) event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Avoid native text selection / iOS callout competing with long-press note edit.
        window.getSelection()?.removeAllRanges();
        startXRef.current = event.clientX;
        startYRef.current = event.clientY;
        axisRef.current = "pending";
        draggedRef.current = false;
        longPressFiredRef.current = false;
        activePointerRef.current = event.pointerId;
        clearLongPressTimer();
        // Record the hit-tested target *before* setPointerCapture below causes
        // subsequent events (including this gesture's pointerup) to report
        // their target as this row instead of the actual element under the pointer.
        downOnOpenTargetRef.current = Boolean((event.target as HTMLElement | null)?.closest(".transaction-row-open"));
        if (onLongPress) {
          longPressTimerRef.current = window.setTimeout(() => {
            if (axisRef.current === "h" || axisRef.current === "v") return;
            if (Math.abs(offsetRef.current) > 0) return;
            longPressFiredRef.current = true;
            draggedRef.current = true;
            clearLongPressTimer();
            setSwiping(false);
            setOffset(0);
            window.getSelection()?.removeAllRanges();
            if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
              navigator.vibrate(12);
            }
            onLongPress();
          }, longPressMs);
        }
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (activePointerRef.current !== event.pointerId || !axisRef.current) return;
        const dx = event.clientX - startXRef.current;
        const dy = event.clientY - startYRef.current;

        if (axisRef.current === "pending") {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          clearLongPressTimer();
          if (Math.abs(dy) > Math.abs(dx)) {
            axisRef.current = "v";
            try {
              (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
            } catch {
              // ignore
            }
            activePointerRef.current = null;
            return;
          }
          axisRef.current = "h";
          setSwiping(true);
        }

        if (axisRef.current !== "h") return;
        draggedRef.current = true;
        setOffset(Math.max(-maxSwipe, Math.min(maxSwipe, dx)));
      }}
      onPointerUp={(event) => {
        try {
          (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
        clearLongPressTimer();
        if (longPressFiredRef.current) {
          finishLongPress();
          return;
        }
        if (activePointerRef.current !== event.pointerId && axisRef.current !== "h") {
          reset();
          return;
        }
        if (axisRef.current === "h" && draggedRef.current) {
          commit();
        } else {
          // Fire the open action here rather than relying on the browser's
          // separately-synthesized click on the nested button — that click is
          // unreliable (sometimes never fires) once this row has taken pointer
          // capture, and event.target is retargeted to this row by then anyway.
          if (onOpenTap && axisRef.current === "pending" && !draggedRef.current && downOnOpenTargetRef.current) {
            tapConsumedRef.current = true;
            onOpenTap();
          }
          reset();
        }
      }}
      onPointerCancel={() => {
        clearLongPressTimer();
        if (longPressFiredRef.current) {
          finishLongPress();
          return;
        }
        reset();
      }}
      onClickCapture={(event) => {
        if (tapConsumedRef.current) {
          event.preventDefault();
          event.stopPropagation();
          tapConsumedRef.current = false;
          return;
        }
        if (!draggedRef.current && !longPressFiredRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        draggedRef.current = false;
        longPressFiredRef.current = false;
      }}
    >
      <div className="swipe-action-layer" aria-hidden="true">
        <div className={`swipe-action recognize${offset > 0 ? " visible" : ""}`}>
          <Check />
        </div>
        <div className={`swipe-action question${offset < 0 ? " visible" : ""}`}>
          <HelpCircle />
        </div>
      </div>
      <div
        className="swipe-content"
        style={{
          transform: `translateX(${offset}px)`,
          transition: swiping ? "none" : "transform .2s ease",
        }}
      >
        {children}
      </div>
    </article>
  );
}

function accountMaskLabel(account: Account) {
  return account.displayMask ?? account.mask ?? account.name;
}

function InstitutionFilterThumb({
  institutionName,
  institutionLogo,
  institutionPrimaryColor,
}: {
  institutionName: string;
  institutionLogo?: string | null;
  institutionPrimaryColor?: string | null;
}) {
  const icon = institutionIconSrc(institutionName, institutionLogo);
  if (icon) {
    return (
      <span className="account-filter-thumb">
        <span className={resolveInstitutionIcon(institutionName) ? "account-filter-icon static-icon" : "account-filter-icon"}>
          <img src={icon} alt="" />
        </span>
      </span>
    );
  }
  return (
    <span className="account-filter-thumb">
      <span
        className="account-filter-icon monogram"
        style={institutionPrimaryColor ? { backgroundColor: institutionPrimaryColor } : undefined}
      >
        {initials(institutionName)}
      </span>
    </span>
  );
}

function useFilterMenu(open: boolean, rootRef: RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, rootRef, onClose]);
}

function formatDeployTimestamp(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function OwnerMenu({
  viewerEmail,
  deployVersion,
}: {
  viewerEmail: string | null;
  deployVersion: { id: string; tag: string | null; timestamp: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useFilterMenu(open, rootRef, () => setOpen(false));
  const versionShort = deployVersion?.id ? deployVersion.id.slice(0, 8) : "local";
  const deployedAt = formatDeployTimestamp(deployVersion?.timestamp ?? null);

  return (
    <div className={open ? "owner-menu open" : "owner-menu"} ref={rootRef}>
      <button
        className="owner-avatar"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Account and deploy version"
        title={viewerEmail ?? "Private workspace"}
        onClick={() => setOpen((current) => !current)}
      >
        {(viewerEmail ?? "L").slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="owner-menu-panel" role="dialog" aria-label="Account">
          <div className="owner-menu-row">
            <span>Signed in</span>
            <strong>{viewerEmail ?? "Private workspace"}</strong>
          </div>
          <div className="owner-menu-row">
            <span>Deploy</span>
            <strong className="owner-menu-version" title={deployVersion?.id ?? "local build"}>
              {versionShort}
            </strong>
          </div>
          {deployVersion?.id && (
            <div className="owner-menu-row">
              <span>Version ID</span>
              <code className="owner-menu-id">{deployVersion.id}</code>
            </div>
          )}
          {deployedAt && (
            <div className="owner-menu-row">
              <span>Built</span>
              <strong>{deployedAt}</strong>
            </div>
          )}
          <p className="owner-menu-hint">Match this ID with `wrangler deploy` output to confirm the live build.</p>
        </div>
      )}
    </div>
  );
}

function SimpleFilterSelect({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useFilterMenu(open, rootRef, () => setOpen(false));
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className={open ? "account-filter-select open" : "account-filter-select"} ref={rootRef}>
      <button
        className="account-filter-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label ?? "All"}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="account-filter-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              className={value === option.value ? "account-filter-option active" : "account-filter-option"}
              type="button"
              role="option"
              aria-selected={value === option.value}
              key={option.value}
              onClick={() => { onChange(option.value); setOpen(false); }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryPrimaryFilterSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (categoryPrimary: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useFilterMenu(open, rootRef, () => setOpen(false));

  return (
    <div className={open ? "account-filter-select open" : "account-filter-select"} ref={rootRef}>
      <button
        className="account-filter-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{categoryLabel(value)}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="account-filter-menu" role="listbox" aria-label="Primary categories">
          <button
            className={value === "all" ? "account-filter-option active" : "account-filter-option"}
            type="button"
            role="option"
            aria-selected={value === "all"}
            onClick={() => { onChange("all"); setOpen(false); }}
          >
            All categories
          </button>
          <button
            className={value === "uncategorized" ? "account-filter-option active" : "account-filter-option"}
            type="button"
            role="option"
            aria-selected={value === "uncategorized"}
            onClick={() => { onChange("uncategorized"); setOpen(false); }}
          >
            Uncategorized
          </button>
          {options.map((option) => (
            <button
              className={value === option ? "account-filter-option active" : "account-filter-option"}
              type="button"
              role="option"
              aria-selected={value === option}
              key={option}
              onClick={() => { onChange(option); setOpen(false); }}
            >
              {categoryLabel(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryDetailedFilterSelect({
  value,
  primary,
  options,
  disabled = false,
  onChange,
}: {
  value: string;
  primary: string;
  options: string[];
  disabled?: boolean;
  onChange: (categoryDetailed: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useFilterMenu(open && !disabled, rootRef, () => setOpen(false));

  return (
    <div className={open && !disabled ? "account-filter-select open" : "account-filter-select"} ref={rootRef}>
      <button
        className="account-filter-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open && !disabled}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
      >
        <span>{detailedCategoryLabel(value, primary !== "all" && primary !== "uncategorized" ? primary : null)}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && !disabled && (
        <div className="account-filter-menu" role="listbox" aria-label="Detailed categories">
          <button
            className={value === "all" ? "account-filter-option active" : "account-filter-option"}
            type="button"
            role="option"
            aria-selected={value === "all"}
            onClick={() => { onChange("all"); setOpen(false); }}
          >
            All details
          </button>
          {primary === "all" && (
            <button
              className={value === "uncategorized" ? "account-filter-option active" : "account-filter-option"}
              type="button"
              role="option"
              aria-selected={value === "uncategorized"}
              onClick={() => { onChange("uncategorized"); setOpen(false); }}
            >
              Uncategorized
            </button>
          )}
          {options.map((option) => (
            <button
              className={value === option ? "account-filter-option active" : "account-filter-option"}
              type="button"
              role="option"
              aria-selected={value === option}
              key={option}
              onClick={() => { onChange(option); setOpen(false); }}
            >
              {detailedCategoryLabel(option, primary !== "all" && primary !== "uncategorized" ? primary : null)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BankFilterSelect({
  value,
  institutions,
  onChange,
}: {
  value: string;
  institutions: Institution[];
  onChange: (institutionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = institutions.find((institution) => institution.itemId === value) ?? null;
  useFilterMenu(open, rootRef, () => setOpen(false));

  return (
    <div className={open ? "account-filter-select open" : "account-filter-select"} ref={rootRef}>
      <button
        className="account-filter-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selected ? (
          <span className="account-filter-option-main">
            <InstitutionFilterThumb
              institutionName={selected.institutionName}
              institutionLogo={selected.institutionLogo}
              institutionPrimaryColor={selected.institutionPrimaryColor}
            />
            <span>{selected.institutionName}</span>
          </span>
        ) : (
          <span>All banks</span>
        )}
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="account-filter-menu" role="listbox" aria-label="Banks">
          <button
            className={value === "all" ? "account-filter-option active" : "account-filter-option"}
            type="button"
            role="option"
            aria-selected={value === "all"}
            onClick={() => { onChange("all"); setOpen(false); }}
          >
            All banks
          </button>
          {institutions.map((institution) => (
            <button
              className={value === institution.itemId ? "account-filter-option active" : "account-filter-option"}
              type="button"
              role="option"
              aria-selected={value === institution.itemId}
              key={institution.itemId}
              onClick={() => { onChange(institution.itemId); setOpen(false); }}
            >
              <span className="account-filter-option-main">
                <InstitutionFilterThumb
                  institutionName={institution.institutionName}
                  institutionLogo={institution.institutionLogo}
                  institutionPrimaryColor={institution.institutionPrimaryColor}
                />
                <span>{institution.institutionName}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountFilterThumb({ account }: { account: Account }) {
  const art = resolveCardArt(account);
  if (art) {
    return (
      <span className="account-filter-thumb">
        <img className="account-filter-art" src={art.src} alt="" />
      </span>
    );
  }
  const icon = institutionIconSrc(account.institutionName, account.institutionLogo);
  if (icon) {
    return (
      <span className="account-filter-thumb">
        <span className={resolveInstitutionIcon(account.institutionName) ? "account-filter-icon static-icon" : "account-filter-icon"}>
          <img src={icon} alt="" />
        </span>
      </span>
    );
  }
  return (
    <span className="account-filter-thumb">
      <span
        className="account-filter-icon monogram"
        style={account.institutionPrimaryColor ? { backgroundColor: account.institutionPrimaryColor } : undefined}
      >
        {initials(account.institutionName ?? account.name)}
      </span>
    </span>
  );
}

function AccountFilterSelect({
  value,
  groups,
  onChange,
}: {
  value: string;
  groups: {
    itemId: string;
    institutionName: string;
    buckets: { bucket: string; label: string; accounts: Account[] }[];
  }[];
  onChange: (accountId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = groups
    .flatMap((group) => group.buckets.flatMap((bucket) => bucket.accounts))
    .find((account) => account.accountId === value) ?? null;
  useFilterMenu(open, rootRef, () => setOpen(false));

  return (
    <div className={open ? "account-filter-select open" : "account-filter-select"} ref={rootRef}>
      <button
        className="account-filter-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selected ? (
          <span className="account-filter-option-main">
            <AccountFilterThumb account={selected} />
            <span className="account-filter-mask">{accountMaskLabel(selected)}</span>
          </span>
        ) : (
          <span>All accounts</span>
        )}
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="account-filter-menu" role="listbox" aria-label="Accounts">
          <button
            className={value === "all" ? "account-filter-option active" : "account-filter-option"}
            type="button"
            role="option"
            aria-selected={value === "all"}
            onClick={() => { onChange("all"); setOpen(false); }}
          >
            All accounts
          </button>
          {groups.map((group) => (
            <div className="account-filter-group" key={group.itemId}>
              <div className="account-filter-bank-label">{group.institutionName}</div>
              {group.buckets.map((bucket) => (
                <div className="account-filter-bucket" key={`${group.itemId}-${bucket.bucket}`}>
                  <div className="account-filter-group-label">{bucket.label}</div>
                  {bucket.accounts.map((account) => (
                    <button
                      className={value === account.accountId ? "account-filter-option active" : "account-filter-option"}
                      type="button"
                      role="option"
                      aria-selected={value === account.accountId}
                      key={account.accountId}
                      onClick={() => { onChange(account.accountId); setOpen(false); }}
                    >
                      <span className="account-filter-option-main">
                        <AccountFilterThumb account={account} />
                        <span className="account-filter-mask">{accountMaskLabel(account)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SortableAccountCard({ account, institution, onOpen }: { account: Account; institution: string; onOpen: (account: Account) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: account.accountId });
  const art = resolveCardArt({ ...account, institutionName: account.institutionName ?? institution });
  const icon = institutionIconSrc(account.institutionName ?? institution, account.institutionLogo);
  const staticIcon = Boolean(resolveInstitutionIcon(account.institutionName ?? institution));
  return <article ref={setNodeRef} className={isDragging ? "account-card dragging" : "account-card"} style={{ transform: CSS.Transform.toString(transform), transition }}>
    {art ? (
      <img className="account-card-art" src={art.src} alt="" />
    ) : icon ? (
      <div className={staticIcon ? "account-card-thumb static-icon" : "account-card-thumb"}><img src={icon} alt="" /></div>
    ) : (
      <div className="account-card-thumb monogram" style={account.institutionPrimaryColor ? { backgroundColor: account.institutionPrimaryColor } : undefined}>{initials(institution)}</div>
    )}
    <div className="account-card-top"><span className={`account-type ${accountBucket(account)}`}>{accountKind(account)}</span><div className="account-card-actions"><span className="account-mask">{formatAccountMask(account)}</span><button className="drag-handle" type="button" aria-label={`Reorder ${account.name}`} {...attributes} {...listeners}><GripVertical aria-hidden="true" /></button></div></div>
    <button className="account-card-open" type="button" onClick={() => onOpen(account)}><div className="account-card-body"><div><h4>{account.name}</h4><p>{account.officialName ?? institution}</p></div><div className="account-balance"><strong>{money(account.currentBalanceMilliunits, account.isoCurrencyCode ?? "USD")}</strong><span>Current balance</span></div></div></button>
  </article>;
}
