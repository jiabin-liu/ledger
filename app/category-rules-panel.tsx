"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { PLAID_PRIMARY_CATEGORIES } from "../lib/categories";

type CategoryRule = {
  id: number;
  pattern: string;
  categoryPrimary: string;
  createdAt: string;
};

function categoryLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function CategoryRulesPanel() {
  const [rules, setRules] = useState<CategoryRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pattern, setPattern] = useState("");
  const [categoryPrimary, setCategoryPrimary] = useState<string>(PLAID_PRIMARY_CATEGORIES[0]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loadRules = () => {
    fetch("/api/category-rules")
      .then((res) => res.json() as Promise<{ rules?: CategoryRule[]; error?: string }>)
      .then((payload) => {
        if (payload.error) throw new Error(payload.error);
        setRules(payload.rules ?? []);
      })
      .catch(() => setError("Couldn't load category rules."));
  };

  useEffect(() => {
    loadRules();
  }, []);

  const addRule = async () => {
    const trimmed = pattern.trim();
    if (trimmed.length < 3) {
      setError("Pattern must be at least 3 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/category-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: trimmed, categoryPrimary }),
      });
      const payload = await response.json() as { error?: string; updated?: number };
      if (!response.ok) throw new Error(payload.error ?? "Unable to create rule.");
      setPattern("");
      setStatus(`Applied to ${payload.updated ?? 0} existing transaction${payload.updated === 1 ? "" : "s"}.`);
      loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create rule.");
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (id: number) => {
    setError(null);
    setRules((current) => (current ? current.filter((rule) => rule.id !== id) : current));
    try {
      const response = await fetch(`/api/category-rules/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "Unable to delete rule.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete rule.");
      loadRules();
    }
  };

  return (
    <section className="tab-content category-rules-panel">
      <div className="section-heading"><h2>Category rules</h2><p>Applied automatically to every future sync</p></div>

      <div className="category-rule-form">
        <input
          type="text"
          className="category-batch-pattern-input"
          placeholder="Text to match, e.g. Vanguard"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          aria-label="Match text"
        />
        <select
          className="category-editor-select"
          value={categoryPrimary}
          onChange={(event) => setCategoryPrimary(event.target.value)}
          aria-label="Category"
        >
          {PLAID_PRIMARY_CATEGORIES.map((value) => (
            <option key={value} value={value}>{categoryLabel(value)}</option>
          ))}
        </select>
        <button type="button" className="button primary small" disabled={saving} onClick={() => void addRule()}>
          {saving ? "Adding…" : "Add rule"}
        </button>
      </div>

      {error && <p className="category-editor-error">{error}</p>}
      {status && <p className="category-editor-hint">{status}</p>}

      <ul className="category-rule-list">
        {rules === null && <li className="insights-empty">Loading…</li>}
        {rules !== null && rules.length === 0 && <li className="insights-empty">No rules yet.</li>}
        {rules?.map((rule) => (
          <li key={rule.id} className="category-rule-row">
            <span className="category-rule-pattern">&ldquo;{rule.pattern}&rdquo;</span>
            <span className="category-rule-arrow">→</span>
            <span className="category-rule-category">{categoryLabel(rule.categoryPrimary)}</span>
            <button
              type="button"
              className="category-rule-delete"
              aria-label={`Delete rule for ${rule.pattern}`}
              onClick={() => void removeRule(rule.id)}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
