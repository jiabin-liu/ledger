"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

type RecurringCadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

type RecurringOccurrence = {
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

type RecurringGroup = {
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

const CADENCE_LABELS: Record<RecurringCadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value / 1000);
}

function initials(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "?";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

export function RecurringPanel() {
  const [groups, setGroups] = useState<RecurringGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/recurring")
      .then((res) => {
        if (!res.ok) throw new Error("Unable to load recurring expenses.");
        return res.json() as Promise<{ groups: RecurringGroup[] }>;
      })
      .then((data) => {
        if (!cancelled) setGroups(data.groups);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load recurring expenses. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const totalMonthlyEquivalent = groups?.reduce((sum, group) => sum + group.monthlyEquivalentMilliunits, 0) ?? 0;

  return (
    <section className="tab-content">
      <div className="section-heading"><h2>Recurring</h2><p>Subscriptions & bills</p></div>

      {error && <div className="status-banner warning">{error}</div>}

      {!error && (
        <>
          <div className="insights-summary-cards recurring-summary-cards">
            <div className="insights-summary-card spending">
              <span>Est. monthly recurring</span>
              <strong>{groups === null ? "—" : money(totalMonthlyEquivalent)}</strong>
            </div>
            <div className="insights-summary-card income">
              <span>Recurring items found</span>
              <strong>{groups === null ? "—" : groups.length}</strong>
            </div>
          </div>

          {groups !== null && groups.length > 0 && (
            <p className="insights-hint">Tap an item to see its past charges.</p>
          )}

          <div className="recurring-list">
            {groups === null && <p className="insights-empty">Loading…</p>}
            {groups !== null && groups.length === 0 && (
              <p className="insights-empty">No recurring expenses found yet. They show up once we see at least two similarly-timed, similarly-priced charges from the same merchant.</p>
            )}
            {groups !== null && groups.map((group) => {
              const isOpen = expanded.has(group.key);
              return (
                <div className="recurring-group" key={group.key}>
                  <button
                    type="button"
                    className="recurring-group-row"
                    aria-expanded={isOpen}
                    onClick={() => toggle(group.key)}
                  >
                    <div className="merchant-avatar">
                      {group.logoUrl ? <img src={group.logoUrl} alt="" /> : initials(group.label)}
                    </div>
                    <div className="recurring-group-main">
                      <div className="recurring-group-title-line">
                        <h3>{group.label}</h3>
                        <span className="recurring-cadence-badge">{CADENCE_LABELS[group.cadence]}</span>
                        {group.likelyEnded && <span className="recurring-ended-badge">Likely ended</span>}
                      </div>
                      <p className="transaction-account-line">
                        {group.occurrenceCount}× seen · last {formatDate(group.lastDate)}
                        {!group.likelyEnded && <> · next ~{formatDate(group.nextExpectedDate)}</>}
                      </p>
                    </div>
                    <div className="recurring-group-amount">
                      <strong className="amount">{money(group.lastAmountMilliunits)}</strong>
                      <ChevronDown aria-hidden="true" className={isOpen ? "recurring-chevron open" : "recurring-chevron"} />
                    </div>
                  </button>
                  {isOpen && (
                    <div className="recurring-occurrence-list">
                      {group.occurrences.map((occurrence) => (
                        <div className="recurring-occurrence-row" key={occurrence.transactionId}>
                          <div className="recurring-occurrence-main">
                            <span className="recurring-occurrence-date">{formatDate(occurrence.date)}</span>
                            <span className="transaction-account-line">
                              {occurrence.accountName ?? "Unknown account"}
                            </span>
                          </div>
                          <strong className="amount">
                            {money(occurrence.amountMilliunits, occurrence.isoCurrencyCode ?? "USD")}
                          </strong>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
