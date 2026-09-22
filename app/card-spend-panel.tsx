"use client";

import { useState } from "react";
import { formatAccountMask } from "../lib/account-display";

type CreditAccount = {
  accountId: string;
  name: string;
  officialName?: string | null;
  mask: string | null;
  displayMask?: string | null;
  institutionName: string | null;
};

type CardSpendSummary = {
  accountId: string;
  transactionCount: number;
  grossSpendMilliunits: number;
  refundMilliunits: number;
  netSpendMilliunits: number;
  firstDate: string | null;
  lastDate: string | null;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 1000);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

function cardLabel(account: CreditAccount) {
  const institution = account.institutionName ? `${account.institutionName} ` : "";
  return `${institution}${account.name} · ${formatAccountMask(account)}`;
}

export function CardSpendPanel({ creditAccounts }: { creditAccounts: CreditAccount[] }) {
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [summary, setSummary] = useState<CardSpendSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectCard = (accountId: string) => {
    setSelectedAccountId(accountId);
    setSummary(null);
    setError(null);
    if (!accountId) return;

    setLoading(true);
    fetch(`/api/card-spend?accountId=${encodeURIComponent(accountId)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Unable to load card spend.");
        return res.json() as Promise<CardSpendSummary>;
      })
      .then((data) => setSummary(data))
      .catch(() => setError("Couldn't load spend for this card. Try again."))
      .finally(() => setLoading(false));
  };

  return (
    <section className="tab-content">
      <div className="section-heading"><h2>Card Spend</h2><p>Track progress toward a signup bonus</p></div>

      <select
        className="card-spend-select"
        value={selectedAccountId}
        onChange={(event) => selectCard(event.target.value)}
        aria-label="Choose a credit card"
      >
        <option value="">Choose a credit card…</option>
        {creditAccounts.map((account) => (
          <option key={account.accountId} value={account.accountId}>{cardLabel(account)}</option>
        ))}
      </select>

      {selectedAccountId && error && <div className="status-banner warning">{error}</div>}

      {selectedAccountId && loading && <p className="insights-empty">Loading…</p>}

      {selectedAccountId && !loading && !error && summary && (
        <>
          <div className="insights-summary-cards card-spend-summary-cards">
            <div className="insights-summary-card spending">
              <span>Net spend</span>
              <strong>{money(summary.netSpendMilliunits)}</strong>
            </div>
            <div className="insights-summary-card income">
              <span>Refunds deducted</span>
              <strong>{money(summary.refundMilliunits)}</strong>
            </div>
          </div>
          <p className="insights-hint card-spend-detail">
            {summary.transactionCount} transaction{summary.transactionCount === 1 ? "" : "s"}
            {summary.firstDate && summary.lastDate && (
              <> · {formatDate(summary.firstDate)} – {formatDate(summary.lastDate)}</>
            )}
            {" "}· {money(summary.grossSpendMilliunits)} gross purchases
          </p>
        </>
      )}
    </section>
  );
}
