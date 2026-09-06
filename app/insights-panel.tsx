"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type InsightsMode = "month" | "year" | "last12";

type CategorySpending = { category: string | null; amountMilliunits: number };

type SpendingSummary = {
  mode: InsightsMode;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  totalSpendingMilliunits: number;
  totalIncomeMilliunits: number;
  byCategory: CategorySpending[];
};

const MODE_OPTIONS: { value: InsightsMode; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "last12", label: "Last 12 Months" },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const UNCATEGORIZED_KEY = "__uncategorized__";

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value / 1000);
}

function categoryLabel(value: string | null) {
  if (!value) return "Uncategorized";
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function categoryKey(value: string | null) {
  return value ?? UNCATEGORIZED_KEY;
}

function periodLabel(summary: SpendingSummary) {
  if (summary.mode === "month") return `${MONTH_NAMES[summary.month - 1]} ${summary.year}`;
  if (summary.mode === "year") return String(summary.year);
  const start = new Date(`${summary.startDate}T12:00:00Z`);
  const end = new Date(new Date(`${summary.endDate}T12:00:00Z`).getTime() - 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(d);
  return `${fmt(start)} – ${fmt(end)}`;
}

export function InsightsPanel() {
  const now = new Date();
  const [mode, setMode] = useState<InsightsMode>("month");
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [summary, setSummary] = useState<SpendingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ mode, year: String(year), month: String(month) });
    fetch(`/api/insights?${query.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Unable to load spending insights.");
        return res.json() as Promise<SpendingSummary>;
      })
      .then((data) => {
        if (!cancelled) {
          setSummary(data);
          setExcludedCategories(new Set());
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load spending insights. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, year, month]);

  const shiftPeriod = (direction: -1 | 1) => {
    if (mode === "month") {
      let nextMonth = month + direction;
      let nextYear = year;
      if (nextMonth < 1) { nextMonth = 12; nextYear -= 1; }
      if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
      setMonth(nextMonth);
      setYear(nextYear);
    } else if (mode === "year") {
      setYear((current) => current + direction);
    }
  };

  const toggleCategory = (key: string) => {
    setExcludedCategories((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const maxCategoryAmount = summary?.byCategory.reduce(
    (max, row) => Math.max(max, row.amountMilliunits),
    0,
  ) ?? 0;

  const includedTotal = useMemo(() => {
    if (!summary) return 0;
    return summary.byCategory.reduce((sum, row) => (
      excludedCategories.has(categoryKey(row.category)) ? sum : sum + row.amountMilliunits
    ), 0);
  }, [summary, excludedCategories]);

  const hasExclusions = excludedCategories.size > 0;

  return (
    <section className="tab-content">
      <div className="section-heading"><h2>Spending</h2><p>By category</p></div>

      <div className="insights-mode-tabs" role="tablist" aria-label="Time period">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={mode === option.value}
            className={mode === option.value ? "insights-mode-tab active" : "insights-mode-tab"}
            onClick={() => setMode(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode !== "last12" && (
        <div className="insights-period-nav">
          <button type="button" aria-label="Previous period" onClick={() => shiftPeriod(-1)}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <span>{summary ? periodLabel(summary) : "\u00A0"}</span>
          <button type="button" aria-label="Next period" onClick={() => shiftPeriod(1)}>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      )}
      {mode === "last12" && summary && (
        <div className="insights-period-nav insights-period-nav-static">
          <span>{periodLabel(summary)}</span>
        </div>
      )}

      {error && <div className="status-banner warning">{error}</div>}

      {!error && (
        <>
          <div className="insights-summary-cards">
            <div className="insights-summary-card spending">
              <span>{hasExclusions ? "Spending (selected)" : "Total spending"}</span>
              <strong>{loading || !summary ? "—" : money(includedTotal)}</strong>
            </div>
            <div className="insights-summary-card income">
              <span>Total income</span>
              <strong>{loading || !summary ? "—" : money(summary.totalIncomeMilliunits)}</strong>
            </div>
          </div>

          {!loading && summary && summary.byCategory.length > 0 && (
            <p className="insights-hint">Tap a category to include or exclude it from the total.</p>
          )}

          <div className="insights-category-list">
            {loading && <p className="insights-empty">Loading…</p>}
            {!loading && summary && summary.byCategory.length === 0 && (
              <p className="insights-empty">No spending in this period.</p>
            )}
            {!loading && summary && summary.byCategory.map((row) => {
              const key = categoryKey(row.category);
              const excluded = excludedCategories.has(key);
              return (
                <button
                  type="button"
                  className={excluded ? "insights-category-row excluded" : "insights-category-row"}
                  key={key}
                  onClick={() => toggleCategory(key)}
                  aria-pressed={!excluded}
                >
                  <div className="insights-category-row-top">
                    <span>{categoryLabel(row.category)}</span>
                    <strong>{money(row.amountMilliunits)}</strong>
                  </div>
                  <div className="insights-category-bar-track">
                    <div
                      className="insights-category-bar-fill"
                      style={{
                        width: maxCategoryAmount > 0
                          ? `${Math.max(4, (row.amountMilliunits / maxCategoryAmount) * 100)}%`
                          : "0%",
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
