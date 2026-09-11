"use client";

import { useEffect, useState } from "react";
import { PLAID_PRIMARY_CATEGORIES } from "../lib/categories";

type CategoryMatch = {
  transactionId: string;
  name: string;
  merchantName: string | null;
  date: string;
  amountMilliunits: number;
  categoryPrimary: string | null;
};

type Props = {
  transactionId: string;
  transactionName: string;
  categoryPrimary: string | null;
  onSaved: (transactionId: string, categoryPrimary: string) => void;
  onBatchApplied: (transactionIds: string[], categoryPrimary: string) => void;
};

const UNCATEGORIZED_VALUE = "__uncategorized__";

function categoryLabel(value: string | null) {
  if (!value) return "Uncategorized";
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Math.abs(value) / 1000);
}

/** Best-guess search phrase for finding similarly-named transactions: the merchant name if
 * present, otherwise the first few non-numeric words (e.g. "Zelle payment to John Doe" -> "Zelle payment to"). */
function suggestMatchPattern(name: string) {
  const words = name.trim().split(/\s+/).filter((word) => !/^\d+$/.test(word) && word.length > 0);
  return words.slice(0, 3).join(" ");
}

export function CategoryEditor({ transactionId, transactionName, categoryPrimary, onSaved, onBatchApplied }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{
    sourceTransactionId: string;
    categoryPrimary: string;
    pattern: string;
    matches: CategoryMatch[];
    loading: boolean;
    applying: boolean;
    saveAsRule: boolean;
  } | null>(null);

  useEffect(() => {
    // If the user navigates to a different transaction, drop any stale prompt for the old one.
    setPrompt((current) => (current?.sourceTransactionId === transactionId ? current : null));
  }, [transactionId]);

  const runSearch = async (pattern: string) => {
    setPrompt((current) => (current ? { ...current, loading: true } : current));
    if (!pattern.trim()) {
      setPrompt((current) => (current ? { ...current, matches: [], loading: false } : current));
      return;
    }
    try {
      const query = new URLSearchParams({ pattern: pattern.trim(), excludeId: transactionId });
      const response = await fetch(`/api/transactions/category-matches?${query.toString()}`);
      const payload = await response.json() as { matches?: CategoryMatch[] };
      setPrompt((current) => (
        current && current.sourceTransactionId === transactionId
          ? { ...current, matches: payload.matches ?? [], loading: false }
          : current
      ));
    } catch {
      setPrompt((current) => (current ? { ...current, matches: [], loading: false } : current));
    }
  };

  const handleChange = async (nextValue: string) => {
    if (nextValue === UNCATEGORIZED_VALUE || nextValue === categoryPrimary) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/transactions/category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId, categoryPrimary: nextValue }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to save category");
      onSaved(transactionId, nextValue);
      const pattern = suggestMatchPattern(transactionName);
      setPrompt({
        sourceTransactionId: transactionId,
        categoryPrimary: nextValue,
        pattern,
        matches: [],
        loading: true,
        applying: false,
        saveAsRule: true,
      });
      void runSearch(pattern);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save category");
    } finally {
      setSaving(false);
    }
  };

  const applyBatch = async () => {
    if (!prompt || prompt.matches.length === 0) return;
    setPrompt((current) => (current ? { ...current, applying: true } : current));
    try {
      const transactionIds = prompt.matches.map((match) => match.transactionId);
      if (prompt.saveAsRule) {
        // Saving a rule backfills every transaction matching the pattern (not just the
        // previewed list) and keeps applying automatically to future Plaid syncs.
        const response = await fetch("/api/category-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pattern: prompt.pattern, categoryPrimary: prompt.categoryPrimary }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to save category rule");
      } else {
        const response = await fetch("/api/transactions/batch-category", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionIds, categoryPrimary: prompt.categoryPrimary }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to update transactions");
      }
      onBatchApplied(transactionIds, prompt.categoryPrimary);
      setPrompt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update transactions");
      setPrompt((current) => (current ? { ...current, applying: false } : current));
    }
  };

  const options = [
    { value: UNCATEGORIZED_VALUE, label: "Uncategorized" },
    ...PLAID_PRIMARY_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) })),
  ];
  const currentValue = categoryPrimary ?? UNCATEGORIZED_VALUE;
  const hasCurrentOption = options.some((option) => option.value === currentValue);

  return (
    <div className="category-editor">
      <select
        className="category-editor-select"
        value={hasCurrentOption ? currentValue : UNCATEGORIZED_VALUE}
        disabled={saving}
        onChange={(event) => void handleChange(event.target.value)}
        aria-label="Category"
      >
        {!hasCurrentOption && <option value={currentValue}>{categoryLabel(categoryPrimary)}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {error && <p className="category-editor-error">{error}</p>}

      {prompt && prompt.sourceTransactionId === transactionId && (prompt.loading || prompt.matches.length > 0) && (
        <div className="category-batch-prompt">
          {prompt.loading ? (
            <p className="category-editor-hint">Looking for similar transactions…</p>
          ) : (
            <>
              <p className="category-editor-hint">
                Found {prompt.matches.length} other transaction{prompt.matches.length === 1 ? "" : "s"} matching:
              </p>
              <input
                type="text"
                className="category-batch-pattern-input"
                value={prompt.pattern}
                onChange={(event) => {
                  const pattern = event.target.value;
                  setPrompt((current) => (current ? { ...current, pattern } : current));
                }}
                onBlur={() => void runSearch(prompt.pattern)}
                aria-label="Match text"
              />
              <ul className="category-batch-match-list">
                {prompt.matches.slice(0, 6).map((match) => (
                  <li key={match.transactionId}>
                    <span>{match.merchantName ?? match.name}</span>
                    <span className="category-batch-match-meta">{match.date} · {money(match.amountMilliunits)}</span>
                  </li>
                ))}
                {prompt.matches.length > 6 && <li className="category-batch-match-more">+{prompt.matches.length - 6} more</li>}
              </ul>
              <label className="category-batch-rule-toggle">
                <input
                  type="checkbox"
                  checked={prompt.saveAsRule}
                  onChange={(event) => {
                    const saveAsRule = event.target.checked;
                    setPrompt((current) => (current ? { ...current, saveAsRule } : current));
                  }}
                />
                Save as a rule so future transactions matching this text are categorized automatically
              </label>
              <div className="category-batch-actions">
                <button
                  type="button"
                  className="button primary small"
                  disabled={prompt.applying || prompt.matches.length === 0}
                  onClick={() => void applyBatch()}
                >
                  {prompt.applying ? "Applying…" : `Apply to ${prompt.matches.length}`}
                </button>
                <button type="button" className="button ghost small" onClick={() => setPrompt(null)}>
                  Skip
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
