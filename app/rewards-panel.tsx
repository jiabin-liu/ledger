"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

type RewardBalance = {
  id: number;
  name: string | null;
  remainingAmount: number | null;
  expirationDate: string | null;
};

type RowDraft = {
  id: number;
  name: string;
  remainingAmount: string;
  expirationDate: string;
};

function toDraft(row: RewardBalance): RowDraft {
  return {
    id: row.id,
    name: row.name ?? "",
    remainingAmount: row.remainingAmount === null ? "" : String(row.remainingAmount),
    expirationDate: row.expirationDate ?? "",
  };
}

type RewardField = "name" | "remainingAmount" | "expirationDate";

export function RewardsPanel() {
  const [rows, setRows] = useState<RowDraft[] | null>(null);
  const [savedRows, setSavedRows] = useState<Map<number, RowDraft>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = () => {
    fetch("/api/reward-balances")
      .then((res) => res.json() as Promise<{ rows?: RewardBalance[]; error?: string }>)
      .then((payload) => {
        if (payload.error) throw new Error(payload.error);
        const drafts = (payload.rows ?? []).map(toDraft);
        setRows(drafts);
        setSavedRows(new Map(drafts.map((draft) => [draft.id, draft])));
      })
      .catch(() => setError("Couldn't load reward balances."));
  };

  useEffect(() => {
    load();
  }, []);

  const updateRow = (id: number, patch: Partial<RowDraft>) => {
    setRows((current) => (current ? current.map((row) => (row.id === id ? { ...row, ...patch } : row)) : current));
  };

  const saveField = async (id: number, field: RewardField, value: string) => {
    const saved = savedRows.get(id);
    if (!saved || saved[field] === value) return;

    let body: Record<string, string | number | null>;
    if (field === "remainingAmount") {
      if (value.trim() === "") {
        body = { remainingAmount: null };
      } else {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed)) {
          setError("Remaining credit must be a number.");
          return;
        }
        body = { remainingAmount: parsed };
      }
    } else {
      const trimmed = value.trim();
      body = { [field]: trimmed === "" ? null : trimmed };
    }

    setError(null);
    try {
      const response = await fetch(`/api/reward-balances/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { row?: RewardBalance; error?: string };
      if (!response.ok || !payload.row) throw new Error(payload.error ?? "Unable to save.");
      const draft = toDraft(payload.row);
      setSavedRows((current) => new Map(current).set(id, draft));
      setRows((current) => (current ? current.map((row) => (row.id === id ? draft : row)) : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save.");
    }
  };

  const addRow = async () => {
    setAdding(true);
    setError(null);
    try {
      const response = await fetch("/api/reward-balances", { method: "POST" });
      const payload = await response.json() as { row?: RewardBalance; error?: string };
      if (!response.ok || !payload.row) throw new Error(payload.error ?? "Unable to add row.");
      const draft = toDraft(payload.row);
      setRows((current) => (current ? [...current, draft] : [draft]));
      setSavedRows((current) => new Map(current).set(draft.id, draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add row.");
    } finally {
      setAdding(false);
    }
  };

  const deleteRow = async (id: number) => {
    setError(null);
    setRows((current) => (current ? current.filter((row) => row.id !== id) : current));
    try {
      const response = await fetch(`/api/reward-balances/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "Unable to delete row.");
      }
      setSavedRows((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete row.");
      load();
    }
  };

  return (
    <section className="tab-content rewards-panel">
      <div className="section-heading"><h2>Rewards</h2><p>Credits, points & miles tracked by hand</p></div>

      {error && <div className="status-banner warning">{error}</div>}

      {rows === null && <p className="insights-empty">Loading…</p>}
      {rows !== null && rows.length === 0 && <p className="insights-empty">No reward balances yet.</p>}

      {rows !== null && rows.length > 0 && (
        <div className="rewards-table">
          <div className="rewards-table-head">
            <span>Name</span>
            <span>Remaining</span>
            <span>Expires</span>
            <span />
          </div>
          {rows.map((row) => (
            <div className="rewards-table-row" key={row.id}>
              <input
                type="text"
                className="rewards-input"
                placeholder="e.g. American Airlines"
                value={row.name}
                onChange={(event) => updateRow(row.id, { name: event.target.value })}
                onBlur={(event) => void saveField(row.id, "name", event.target.value)}
                aria-label="Name"
              />
              <input
                type="text"
                inputMode="decimal"
                className="rewards-input rewards-input-amount"
                placeholder="e.g. 70000"
                value={row.remainingAmount}
                onChange={(event) => updateRow(row.id, { remainingAmount: event.target.value })}
                onBlur={(event) => void saveField(row.id, "remainingAmount", event.target.value)}
                aria-label="Remaining credit, points, or miles"
              />
              <input
                type="date"
                className="rewards-input"
                value={row.expirationDate}
                onChange={(event) => {
                  updateRow(row.id, { expirationDate: event.target.value });
                  void saveField(row.id, "expirationDate", event.target.value);
                }}
                aria-label="Expiration date"
              />
              <button
                type="button"
                className="category-rule-delete"
                aria-label="Delete row"
                onClick={() => void deleteRow(row.id)}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button type="button" className="button ghost small rewards-add-button" disabled={adding} onClick={() => void addRow()}>
        <Plus aria-hidden="true" /> {adding ? "Adding…" : "Add row"}
      </button>
    </section>
  );
}
