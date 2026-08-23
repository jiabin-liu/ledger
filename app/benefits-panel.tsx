"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import {
  activePeriodKeysForYear,
  cadenceLabel,
  formatBenefitWindow,
  periodKeysForCadence,
  type BenefitCadence,
  type BenefitStatus,
} from "../lib/benefits-shared";
import { formatAccountMask } from "../lib/account-display";
import { resolveCardArt } from "../lib/card-art";

type CreditAccount = {
  accountId: string;
  name: string;
  officialName?: string | null;
  mask: string | null;
  displayMask?: string | null;
  type?: string | null;
  institutionName: string | null;
  institutionLogo: string | null;
  institutionPrimaryColor: string | null;
};

type CardProduct = { id: number; name: string; createdAt: string; updatedAt: string };
type BenefitDef = {
  id: number;
  productId: number;
  name: string;
  amountMilliunits: number;
  cadence: string;
  effectiveFromYear: number | null;
  effectiveFromPeriod: string | null;
  effectiveToYear: number | null;
  effectiveToPeriod: string | null;
  sortOrder: number;
};
type BenefitAssignment = { id: number; accountId: string; productId: number };
type BenefitPeriod = {
  id: number;
  accountId: string;
  benefitDefId: number;
  year: number;
  periodKey: string;
  status: string;
};

type Bundle = {
  products: CardProduct[];
  defs: BenefitDef[];
  assignments: BenefitAssignment[];
  periods: BenefitPeriod[];
  year: number;
};

function money(milliunits: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    .format(milliunits / 1000);
}

function initials(value: string) {
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function statusLabel(status: string) {
  if (status === "n/a") return "N/A";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusMark(status: string) {
  switch (status) {
    case "used":
      return "✓";
    case "missed":
      return "✕";
    case "n/a":
      return "—";
    default:
      return "○";
  }
}

const STATUS_CYCLE: BenefitStatus[] = ["available", "used", "missed", "n/a"];

type DraftBenefit = {
  name: string;
  amountDollars: string;
  cadence: BenefitCadence;
  effectiveFromYear: string;
  effectiveFromPeriod: string;
  effectiveToYear: string;
  effectiveToPeriod: string;
};

const emptyDraft = (): DraftBenefit => ({
  name: "",
  amountDollars: "",
  cadence: "annual",
  effectiveFromYear: "",
  effectiveFromPeriod: "",
  effectiveToYear: "",
  effectiveToPeriod: "",
});

function updateDraft(
  setter: Dispatch<SetStateAction<DraftBenefit[]>>,
  index: number,
  patch: Partial<DraftBenefit>,
) {
  setter((current) => current.map((item, i) => {
    if (i !== index) return item;
    const next = { ...item, ...patch };
    if (patch.cadence && patch.cadence !== item.cadence) {
      next.effectiveFromPeriod = "";
      next.effectiveToPeriod = "";
    }
    return next;
  }));
}

export function BenefitsPanel({
  creditAccounts,
  initialBundle,
  onDetailHistoryChange,
}: {
  creditAccounts: CreditAccount[];
  initialBundle: Bundle;
  onDetailHistoryChange?: (active: boolean) => void;
}) {
  const [year, setYear] = useState(initialBundle.year);
  const [bundle, setBundle] = useState(initialBundle);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [templateOverlay, setTemplateOverlay] = useState<null | { kind: "create" } | { kind: "edit"; productId: number }>(null);
  const [templateName, setTemplateName] = useState("");
  const [draftBenefits, setDraftBenefits] = useState<DraftBenefit[]>([emptyDraft()]);
  const [addDraftByProduct, setAddDraftByProduct] = useState<Record<number, DraftBenefit>>({});
  const detailHistoryPushedRef = useRef(false);
  const detailSheetRef = useRef<HTMLElement | null>(null);
  const onDetailHistoryChangeRef = useRef(onDetailHistoryChange);
  onDetailHistoryChangeRef.current = onDetailHistoryChange;

  const markDetailHistory = (active: boolean) => {
    detailHistoryPushedRef.current = active;
    onDetailHistoryChangeRef.current?.(active);
  };

  const pushBenefitsOverlay = (kind: "detail" | "templates") => {
    if (detailHistoryPushedRef.current) return;
    // Do not replaceState first — preserves iOS previous-page screenshot for gesture back.
    const url = new URL(window.location.href);
    url.searchParams.set("view", `benefits-${kind}`);
    const proto = History.prototype;
    proto.pushState.call(
      window.history,
      { __NA: true, ledgerBenefitsOverlay: kind },
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    markDetailHistory(true);
  };

  const openCardDetail = (accountId: string) => {
    if (selectedAccountId === accountId) return;
    setTemplateOverlay(null);
    pushBenefitsOverlay("detail");
    setSelectedAccountId(accountId);
  };

  const closeCardDetail = () => {
    if (detailHistoryPushedRef.current) {
      window.history.back();
      return;
    }
    setSelectedAccountId(null);
  };

  const openCreateTemplate = () => {
    if (templateOverlay?.kind === "create") return;
    setSelectedAccountId(null);
    pushBenefitsOverlay("templates");
    setTemplateOverlay({ kind: "create" });
  };

  const openEditTemplate = (productId: number) => {
    if (templateOverlay?.kind === "edit" && templateOverlay.productId === productId) return;
    setSelectedAccountId(null);
    pushBenefitsOverlay("templates");
    setTemplateOverlay({ kind: "edit", productId });
  };

  const closeTemplates = () => {
    if (detailHistoryPushedRef.current) {
      window.history.back();
      return;
    }
    setTemplateOverlay(null);
  };

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (!detailHistoryPushedRef.current) return;
      if ((event.state as { ledgerBenefitsOverlay?: string } | null)?.ledgerBenefitsOverlay) return;
      markDetailHistory(false);
      setSelectedAccountId(null);
      setTemplateOverlay(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (detailHistoryPushedRef.current) markDetailHistory(false);
    };
  }, []);

  useEffect(() => {
    if (!selectedAccountId && !templateOverlay) return;
    const panel = detailSheetRef.current;
    if (panel) panel.scrollTop = 0;
  }, [selectedAccountId, templateOverlay]);

  const assignmentByAccount = useMemo(() => {
    const map = new Map<string, BenefitAssignment>();
    for (const row of bundle.assignments) map.set(row.accountId, row);
    return map;
  }, [bundle.assignments]);

  const productById = useMemo(() => {
    const map = new Map<number, CardProduct>();
    for (const row of bundle.products) map.set(row.id, row);
    return map;
  }, [bundle.products]);

  const productsWithCards = useMemo(() => {
    return bundle.products.filter((product) =>
      bundle.assignments.some((row) => row.productId === product.id),
    );
  }, [bundle.products, bundle.assignments]);

  const periodLookup = useMemo(() => {
    const map = new Map<string, BenefitPeriod>();
    for (const period of bundle.periods) {
      map.set(`${period.accountId}:${period.benefitDefId}:${period.periodKey}`, period);
    }
    return map;
  }, [bundle.periods]);

  const matrixGroups = useMemo(() => {
    return productsWithCards.map((product) => {
      const defs = bundle.defs
        .filter((def) => def.productId === product.id)
        .map((def) => ({
          def,
          periodKeys: activePeriodKeysForYear(def, year),
        }))
        .filter((row) => row.periodKeys.length > 0);
      const columns = defs.flatMap(({ def, periodKeys }) =>
        periodKeys.map((periodKey) => ({
          key: `${def.id}:${periodKey}`,
          defId: def.id,
          defName: def.name,
          periodKey,
        })),
      );
      const cards = creditAccounts
        .filter((account) => assignmentByAccount.get(account.accountId)?.productId === product.id);
      return { product, defs, columns, cards };
    }).filter((group) => group.cards.length > 0);
  }, [productsWithCards, bundle.defs, year, creditAccounts, assignmentByAccount]);

  const unassignedCards = useMemo(
    () => creditAccounts.filter((account) => !assignmentByAccount.has(account.accountId)),
    [creditAccounts, assignmentByAccount],
  );

  const loadYear = async (nextYear: number) => {
    setBusy(true); setStatus(null);
    try {
      const response = await fetch(`/api/benefits?year=${nextYear}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load benefits");
      setBundle(payload);
      setYear(payload.year);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load benefits");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (year !== initialBundle.year) return;
    setBundle(initialBundle);
  }, [initialBundle, year]);

  const refresh = () => loadYear(year);

  const createTemplate = async () => {
    setBusy(true); setStatus(null);
    try {
      const benefits = draftBenefits
        .map((row) => ({
          name: row.name.trim(),
          amountDollars: Number.parseFloat(row.amountDollars),
          cadence: row.cadence,
          effectiveFromYear: row.effectiveFromYear ? Number.parseInt(row.effectiveFromYear, 10) : null,
          effectiveFromPeriod: row.effectiveFromPeriod || null,
          effectiveToYear: row.effectiveToYear ? Number.parseInt(row.effectiveToYear, 10) : null,
          effectiveToPeriod: row.effectiveToPeriod || null,
        }))
        .filter((row) => row.name);
      const response = await fetch("/api/benefits/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: templateName.trim(), benefits }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to create template");
      setTemplateName("");
      setDraftBenefits([emptyDraft()]);
      setStatus(`Created template “${payload.product.name}”.`);
      await refresh();
      closeTemplates();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create template");
      setBusy(false);
    }
  };

  const deleteTemplate = async (productId: number) => {
    if (!window.confirm("Delete this template and all tracking for cards using it?")) return;
    setBusy(true); setStatus(null);
    try {
      const response = await fetch(`/api/benefits/products/${productId}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to delete template");
      setStatus("Template deleted.");
      if (templateOverlay?.kind === "edit" && templateOverlay.productId === productId) {
        if (detailHistoryPushedRef.current) {
          markDetailHistory(false);
          setTemplateOverlay(null);
          History.prototype.replaceState.call(window.history, null, "");
        } else {
          setTemplateOverlay(null);
        }
      }
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete template");
      setBusy(false);
    }
  };

  const renameTemplate = async (productId: number, name: string) => {
    const next = name.trim();
    if (!next) {
      setStatus("Template name is required.");
      return;
    }
    setBusy(true); setStatus(null);
    try {
      const response = await fetch(`/api/benefits/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to rename template");
      setStatus(`Renamed template to “${payload.product.name}”.`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to rename template");
      setBusy(false);
    }
  };

  const saveBenefit = async (
    def: BenefitDef,
    patch: {
      name: string;
      effectiveFromYear: number | null;
      effectiveFromPeriod: string | null;
      effectiveToYear: number | null;
      effectiveToPeriod: string | null;
    },
  ) => {
    setBusy(true); setStatus(null);
    try {
      const response = await fetch(`/api/benefits/defs/${def.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, year }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to update benefit");
      setStatus(`Saved “${payload.def?.name ?? patch.name}”.`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update benefit");
      setBusy(false);
    }
  };

  const addBenefitToProduct = async (productId: number) => {
    const draft = addDraftByProduct[productId] ?? emptyDraft();
    setBusy(true); setStatus(null);
    try {
      const response = await fetch(`/api/benefits/products/${productId}/benefits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          amountDollars: Number.parseFloat(draft.amountDollars),
          cadence: draft.cadence,
          effectiveFromYear: draft.effectiveFromYear ? Number.parseInt(draft.effectiveFromYear, 10) : null,
          effectiveFromPeriod: draft.effectiveFromPeriod || null,
          effectiveToYear: draft.effectiveToYear ? Number.parseInt(draft.effectiveToYear, 10) : null,
          effectiveToPeriod: draft.effectiveToPeriod || null,
          year,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to add benefit");
      setAddDraftByProduct((current) => ({ ...current, [productId]: emptyDraft() }));
      setStatus(`Added “${payload.def.name}” to template.`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to add benefit");
      setBusy(false);
    }
  };

  const assignTemplate = async (accountId: string, productId: number) => {
    setBusy(true); setStatus(null);
    try {
      const response = await fetch("/api/benefits/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, productId, year }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to assign template");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to assign template");
      setBusy(false);
    }
  };

  const unassignTemplate = async (accountId: string) => {
    if (!window.confirm("Remove benefit tracking for this card? Period history for this card will be cleared.")) return;
    setBusy(true); setStatus(null);
    try {
      const response = await fetch("/api/benefits/assign", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to unassign");
      if (selectedAccountId === accountId) closeCardDetail();
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to unassign");
      setBusy(false);
    }
  };

  const cycleStatus = async (period: BenefitPeriod) => {
    const current = STATUS_CYCLE.includes(period.status as BenefitStatus)
      ? (period.status as BenefitStatus)
      : "available";
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length];
    const previous = bundle;
    setBundle({
      ...bundle,
      periods: bundle.periods.map((row) => (row.id === period.id ? { ...row, status: next } : row)),
    });
    try {
      const response = await fetch("/api/benefits/periods", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: period.id, status: next }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to update status");
    } catch (error) {
      setBundle(previous);
      setStatus(error instanceof Error ? error.message : "Unable to update status");
    }
  };

  const selectedAccount = creditAccounts.find((account) => account.accountId === selectedAccountId) ?? null;
  const selectedAssignment = selectedAccountId ? assignmentByAccount.get(selectedAccountId) : undefined;
  const selectedProduct = selectedAssignment ? productById.get(selectedAssignment.productId) : undefined;
  const selectedDefs = selectedAssignment
    ? bundle.defs.filter((def) => def.productId === selectedAssignment.productId)
    : [];
  const selectedPeriods = selectedAccountId
    ? bundle.periods.filter((period) => period.accountId === selectedAccountId)
    : [];

  const yearOptions = [year - 1, year, year + 1]
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => b - a);
  if (!yearOptions.includes(new Date().getFullYear())) {
    yearOptions.push(new Date().getFullYear());
    yearOptions.sort((a, b) => b - a);
  }

  const detailOpen = Boolean(selectedAccount && selectedAssignment && selectedProduct);
  const listCovered = detailOpen || Boolean(templateOverlay);
  const editingProduct = templateOverlay?.kind === "edit"
    ? productById.get(templateOverlay.productId) ?? null
    : null;

  return (
    <>
      {templateOverlay && (
        <section ref={detailSheetRef} className="detail-panel" aria-labelledby="benefits-templates-title">
          <div className="account-detail detail-panel-inner benefits-layout">
            {status && <div className="status-banner" role="status">{status}</div>}
            <div className="section-heading">
              <button className="button ghost small" type="button" onClick={closeTemplates}>
                <ArrowLeft aria-hidden="true" /> Benefits
              </button>
            </div>

            {templateOverlay.kind === "create" ? (
              <div className="template-editor">
                <div className="template-editor-top">
                  <h2 id="benefits-templates-title" className="benefits-template-edit-title">New template</h2>
                  <p className="template-editor-meta">{draftBenefits.filter((row) => row.name.trim()).length || draftBenefits.length} benefit draft{draftBenefits.length === 1 ? "" : "s"}</p>
                  <label className="benefits-field template-editor-name">
                    <span>Template name</span>
                    <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Amex Platinum" />
                  </label>
                </div>

                <div className="template-editor-list">
                  {draftBenefits.map((row, index) => (
                    <article className="template-editor-item" key={index}>
                      <div className="template-editor-item-head">
                        <div className="template-editor-item-title-row">
                          <strong>Benefit {index + 1}</strong>
                          {draftBenefits.length > 1 && (
                            <button
                              className="button ghost small"
                              type="button"
                              onClick={() => setDraftBenefits((current) => current.filter((_, i) => i !== index))}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="benefits-draft-row">
                        <label className="benefits-field">
                          <span>Name</span>
                          <input value={row.name} onChange={(event) => updateDraft(setDraftBenefits, index, { name: event.target.value })} placeholder="Saks" />
                        </label>
                        <label className="benefits-field">
                          <span>Amount</span>
                          <input inputMode="decimal" value={row.amountDollars} onChange={(event) => updateDraft(setDraftBenefits, index, { amountDollars: event.target.value })} placeholder="50" />
                        </label>
                        <label className="benefits-field">
                          <span>Cadence</span>
                          <select value={row.cadence} onChange={(event) => updateDraft(setDraftBenefits, index, { cadence: event.target.value as BenefitCadence })}>
                            <option value="annual">Annual</option>
                            <option value="semi_annual">Semi-annual</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="monthly">Monthly</option>
                          </select>
                        </label>
                      </div>
                      <div className="benefits-window-grid">
                        <label className="benefits-field">
                          <span>From year</span>
                          <input inputMode="numeric" value={row.effectiveFromYear} onChange={(event) => updateDraft(setDraftBenefits, index, { effectiveFromYear: event.target.value })} placeholder="—" />
                        </label>
                        <label className="benefits-field">
                          <span>From period</span>
                          <select value={row.effectiveFromPeriod} onChange={(event) => updateDraft(setDraftBenefits, index, { effectiveFromPeriod: event.target.value })}>
                            <option value="">Start of year</option>
                            {periodKeysForCadence(row.cadence).map((key) => (
                              <option key={key} value={key}>{key === "Y" ? "Year" : key}</option>
                            ))}
                          </select>
                        </label>
                        <label className="benefits-field">
                          <span>To year</span>
                          <input inputMode="numeric" value={row.effectiveToYear} onChange={(event) => updateDraft(setDraftBenefits, index, { effectiveToYear: event.target.value })} placeholder="—" />
                        </label>
                        <label className="benefits-field">
                          <span>To period</span>
                          <select value={row.effectiveToPeriod} onChange={(event) => updateDraft(setDraftBenefits, index, { effectiveToPeriod: event.target.value })}>
                            <option value="">End of year</option>
                            {periodKeysForCadence(row.cadence).map((key) => (
                              <option key={key} value={key}>{key === "Y" ? "Year" : key}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </article>
                  ))}

                  <div className="template-editor-item-actions template-editor-create-actions">
                    <button className="button ghost small" type="button" onClick={() => setDraftBenefits((current) => [...current, emptyDraft()])}>
                      <Plus aria-hidden="true" /> Add benefit
                    </button>
                    <button className="button primary small" type="button" disabled={busy || !templateName.trim()} onClick={() => void createTemplate()}>
                      Save template
                    </button>
                  </div>
                </div>
              </div>
            ) : editingProduct ? (
              <TemplateEditor
                product={editingProduct}
                defs={bundle.defs.filter((def) => def.productId === editingProduct.id)}
                cardCount={bundle.assignments.filter((row) => row.productId === editingProduct.id).length}
                busy={busy}
                addDraft={addDraftByProduct[editingProduct.id] ?? emptyDraft()}
                setAddDraft={(patch) => {
                  setAddDraftByProduct((current) => {
                    const base = current[editingProduct.id] ?? emptyDraft();
                    const next = { ...base, ...patch };
                    if (patch.cadence && patch.cadence !== base.cadence) {
                      next.effectiveFromPeriod = "";
                      next.effectiveToPeriod = "";
                    }
                    return { ...current, [editingProduct.id]: next };
                  });
                }}
                onRename={(name) => void renameTemplate(editingProduct.id, name)}
                onDelete={() => void deleteTemplate(editingProduct.id)}
                onSaveBenefit={(def, patch) => void saveBenefit(def, patch)}
                onAddBenefit={() => void addBenefitToProduct(editingProduct.id)}
              />
            ) : (
              <div className="empty-state"><h3>Template not found</h3><p>It may have been deleted.</p></div>
            )}
          </div>
        </section>
      )}

      {detailOpen && selectedAccount && selectedAssignment && selectedProduct && (
        <section ref={templateOverlay ? undefined : detailSheetRef} className="detail-panel" aria-labelledby="benefits-detail-title">
          <div className="account-detail detail-panel-inner benefits-layout">
            {status && <div className="status-banner" role="status">{status}</div>}
            <div className="section-heading">
              <button className="button ghost small" type="button" onClick={closeCardDetail}>
                <ArrowLeft aria-hidden="true" /> Cards
              </button>
              <label className="benefits-year-select">
                <span>Year</span>
                <select value={year} disabled={busy} onChange={(event) => loadYear(Number.parseInt(event.target.value, 10))}>
                  {yearOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            </div>

            <div className="benefits-card-header">
              <BenefitCardThumb account={selectedAccount} />
              <div>
                <h2 id="benefits-detail-title">{selectedAccount.name}</h2>
                <p>{selectedAccount.institutionName ?? "Credit card"} · {formatAccountMask(selectedAccount)} · {selectedProduct.name}</p>
              </div>
            </div>
            <p className="benefits-hint">Tap a period to cycle: Available → Used → Missed → N/A.</p>

            <div className="benefits-detail-list">
              {selectedDefs.length === 0 ? (
                <div className="empty-state"><h3>No benefits on this template</h3><p>Edit the template to add benefits.</p></div>
              ) : selectedDefs.map((def) => {
                const periods = selectedPeriods
                  .filter((period) => period.benefitDefId === def.id)
                  .sort((a, b) => a.periodKey.localeCompare(b.periodKey, undefined, { numeric: true }));
                if (periods.length === 0) return null;
                return (
                  <article className="benefits-detail-card" key={def.id}>
                    <div className="benefits-detail-top">
                      <div>
                        <h3>{def.name}</h3>
                        <p>{money(def.amountMilliunits)} / period · {cadenceLabel(def.cadence)}</p>
                      </div>
                    </div>
                    <div className="benefits-period-grid">
                      {periods.map((period) => (
                        <button
                          key={period.id}
                          type="button"
                          className={`benefits-period-chip status-${period.status.replace("/", "")}`}
                          disabled={busy}
                          onClick={() => cycleStatus(period)}
                        >
                          <strong>{period.periodKey === "Y" ? "Year" : period.periodKey}</strong>
                          <span>{statusLabel(period.status)}</span>
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="benefits-form-actions" style={{ marginTop: "1rem" }}>
              <button className="button ghost small" type="button" disabled={busy} onClick={() => unassignTemplate(selectedAccount.accountId)}>
                Remove template
              </button>
            </div>
          </div>
        </section>
      )}

      <section
        className={listCovered ? "tab-content benefits-layout is-covered" : "tab-content benefits-layout"}
        aria-hidden={listCovered}
      >
      {status && !listCovered && <div className="status-banner" role="status">{status}</div>}
      <div className="section-heading benefits-section-heading">
        <div>
          <h2>Credit card benefits</h2>
          <p>{creditAccounts.length} credit card{creditAccounts.length === 1 ? "" : "s"}</p>
        </div>
        <button className="button primary small" type="button" onClick={openCreateTemplate}>
          <Plus aria-hidden="true" /> Template
        </button>
      </div>

      <label className="benefits-year-select">
        <span>Year</span>
        <select value={year} disabled={busy} onChange={(event) => loadYear(Number.parseInt(event.target.value, 10))}>
          {yearOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>

      {creditAccounts.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">↗</div><h3>No credit cards</h3><p>Connect a credit card from Accounts, then assign a benefit template here.</p></div>
      ) : (
        <div className="benefits-matrix-stack">
          {matrixGroups.map((group) => (
            <div className="benefits-matrix-panel" key={group.product.id}>
              <div className="benefits-matrix-header">
                <h3 className="benefits-matrix-title">
                  {group.product.name}
                  <span className="benefits-matrix-count"> ({group.cards.length})</span>
                </h3>
                <button
                  className="benefits-matrix-edit"
                  type="button"
                  aria-label={`Edit ${group.product.name} template`}
                  title="Edit template"
                  onClick={() => openEditTemplate(group.product.id)}
                >
                  <Pencil aria-hidden="true" />
                </button>
              </div>
              <div className="benefits-matrix-scroll" role="region" aria-label={`${group.product.name} benefit matrix`}>
                <table className="benefits-matrix">
                  <thead>
                    <tr>
                      <th className="benefits-matrix-sticky" rowSpan={2}>Card</th>
                      {group.defs.map(({ def, periodKeys }) => (
                        <th key={def.id} colSpan={periodKeys.length}>
                          <span className="benefits-matrix-def">
                            <span className="benefits-matrix-def-name">{def.name}</span>
                            <span className="benefits-matrix-def-amount">{money(def.amountMilliunits)}</span>
                          </span>
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {group.columns.map((column) => (
                        <th key={column.key} className="benefits-matrix-period">
                          {column.periodKey === "Y" ? "Year" : column.periodKey}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.cards.map((account) => {
                      const used = group.columns.reduce((count, column) => {
                        const period = periodLookup.get(`${account.accountId}:${column.defId}:${column.periodKey}`);
                        return count + (period?.status === "used" ? 1 : 0);
                      }, 0);
                      return (
                        <tr key={account.accountId}>
                          <th className="benefits-matrix-sticky" scope="row">
                            <button type="button" className="benefits-matrix-card" onClick={() => openCardDetail(account.accountId)}>
                              <BenefitCardThumb account={account} compact />
                              <span className="benefits-matrix-card-copy">
                                <strong>{formatAccountMask(account)}</strong>
                                <span>{used}/{group.columns.length} used</span>
                              </span>
                            </button>
                          </th>
                          {group.columns.map((column) => {
                            const period = periodLookup.get(`${account.accountId}:${column.defId}:${column.periodKey}`);
                            if (!period) {
                              return (
                                <td key={column.key}>
                                  <span className="benefits-matrix-cell status-na" title="Not generated">—</span>
                                </td>
                              );
                            }
                            return (
                              <td key={column.key}>
                                <button
                                  type="button"
                                  className={`benefits-matrix-cell status-${period.status.replace("/", "")}`}
                                  disabled={busy}
                                  title={`${column.defName} ${column.periodKey}: ${statusLabel(period.status)}`}
                                  onClick={() => void cycleStatus(period)}
                                >
                                  {statusMark(period.status)}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {unassignedCards.length > 0 && (
            <div className="connections-list benefits-unassigned" aria-label="Cards without a template">
              <h3 className="account-group-label">No template</h3>
              {unassignedCards.map((account) => (
                <div className="connection-row" key={account.accountId}>
                  <div className="connection-identity">
                    <BenefitCardThumb account={account} />
                    <div className="connection-copy">
                      <strong>{account.name}</strong>
                      <div className="connection-copy-meta">
                        <span className="timestamp">{formatAccountMask(account)}</span>
                        <span className="timestamp">{account.institutionName ?? "Credit card"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="connection-actions">
                    {bundle.products.length === 0 ? (
                      <button className="button ghost small" type="button" onClick={openCreateTemplate}>Create template</button>
                    ) : (
                      <select
                        className="benefits-assign-select"
                        disabled={busy}
                        defaultValue=""
                        onChange={(event) => {
                          const productId = Number.parseInt(event.target.value, 10);
                          if (productId) void assignTemplate(account.accountId, productId);
                          event.target.value = "";
                        }}
                      >
                        <option value="" disabled>Assign…</option>
                        {bundle.products.map((productOption) => (
                          <option key={productOption.id} value={productOption.id}>{productOption.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </section>
    </>
  );
}


function TemplateEditor({
  product,
  defs,
  cardCount,
  busy,
  addDraft,
  setAddDraft,
  onRename,
  onDelete,
  onSaveBenefit,
  onAddBenefit,
}: {
  product: CardProduct;
  defs: BenefitDef[];
  cardCount: number;
  busy: boolean;
  addDraft: DraftBenefit;
  setAddDraft: (patch: Partial<DraftBenefit>) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSaveBenefit: (
    def: BenefitDef,
    patch: {
      name: string;
      effectiveFromYear: number | null;
      effectiveFromPeriod: string | null;
      effectiveToYear: number | null;
      effectiveToPeriod: string | null;
    },
  ) => void;
  onAddBenefit: () => void;
}) {
  return (
    <div className="template-editor">
      <div className="template-editor-top">
        <h2 id="benefits-templates-title" className="benefits-template-edit-title">{product.name}</h2>
        <p className="template-editor-meta">{defs.length} benefit{defs.length === 1 ? "" : "s"} · {cardCount} card{cardCount === 1 ? "" : "s"}</p>
        <label className="benefits-field template-editor-name">
          <span>Rename</span>
          <div className="template-editor-name-row">
            <input defaultValue={product.name} id={`product-name-${product.id}`} />
            <button
              className="button ghost small"
              type="button"
              disabled={busy}
              onClick={() => {
                const input = document.getElementById(`product-name-${product.id}`) as HTMLInputElement | null;
                onRename(input?.value ?? product.name);
              }}
            >
              Save
            </button>
          </div>
        </label>
      </div>

      <div className="template-editor-list">
        {defs.map((def) => (
          <article className="template-editor-item" key={def.id}>
            <div className="template-editor-item-head">
              <label className="benefits-field">
                <span>Benefit</span>
                <input defaultValue={def.name} id={`name-${def.id}`} />
              </label>
              <p className="template-editor-item-meta">
                {money(def.amountMilliunits)} · {cadenceLabel(def.cadence)}
                <span aria-hidden="true"> · </span>
                {formatBenefitWindow(def)}
              </p>
            </div>
            <div className="benefits-window-grid">
              <label className="benefits-field">
                <span>From year</span>
                <input inputMode="numeric" defaultValue={def.effectiveFromYear ?? ""} placeholder="—" id={`from-year-${def.id}`} />
              </label>
              <label className="benefits-field">
                <span>From period</span>
                <select defaultValue={def.effectiveFromPeriod ?? ""} id={`from-period-${def.id}`}>
                  <option value="">Start of year</option>
                  {periodKeysForCadence(def.cadence).map((key) => (
                    <option key={key} value={key}>{key === "Y" ? "Year" : key}</option>
                  ))}
                </select>
              </label>
              <label className="benefits-field">
                <span>To year</span>
                <input inputMode="numeric" defaultValue={def.effectiveToYear ?? ""} placeholder="—" id={`to-year-${def.id}`} />
              </label>
              <label className="benefits-field">
                <span>To period</span>
                <select defaultValue={def.effectiveToPeriod ?? ""} id={`to-period-${def.id}`}>
                  <option value="">End of year</option>
                  {periodKeysForCadence(def.cadence).map((key) => (
                    <option key={key} value={key}>{key === "Y" ? "Year" : key}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="template-editor-item-actions">
              <button
                className="button ghost small"
                type="button"
                disabled={busy}
                onClick={() => {
                  const nameEl = document.getElementById(`name-${def.id}`) as HTMLInputElement | null;
                  const fromYearEl = document.getElementById(`from-year-${def.id}`) as HTMLInputElement | null;
                  const fromPeriodEl = document.getElementById(`from-period-${def.id}`) as HTMLSelectElement | null;
                  const toYearEl = document.getElementById(`to-year-${def.id}`) as HTMLInputElement | null;
                  const toPeriodEl = document.getElementById(`to-period-${def.id}`) as HTMLSelectElement | null;
                  onSaveBenefit(def, {
                    name: nameEl?.value?.trim() || def.name,
                    effectiveFromYear: fromYearEl?.value ? Number.parseInt(fromYearEl.value, 10) : null,
                    effectiveFromPeriod: fromPeriodEl?.value || null,
                    effectiveToYear: toYearEl?.value ? Number.parseInt(toYearEl.value, 10) : null,
                    effectiveToPeriod: toPeriodEl?.value || null,
                  });
                }}
              >
                Save
              </button>
            </div>
          </article>
        ))}

        <article className="template-editor-item is-add">
          <h3 className="template-editor-add-title">Add benefit</h3>
          <div className="benefits-draft-row">
            <label className="benefits-field">
              <span>Name</span>
              <input value={addDraft.name} onChange={(event) => setAddDraft({ name: event.target.value })} placeholder="ChatGPT" />
            </label>
            <label className="benefits-field">
              <span>Amount</span>
              <input inputMode="decimal" value={addDraft.amountDollars} onChange={(event) => setAddDraft({ amountDollars: event.target.value })} placeholder="300" />
            </label>
            <label className="benefits-field">
              <span>Cadence</span>
              <select value={addDraft.cadence} onChange={(event) => setAddDraft({ cadence: event.target.value as BenefitCadence })}>
                <option value="annual">Annual</option>
                <option value="semi_annual">Semi-annual</option>
                <option value="quarterly">Quarterly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
          </div>
          <div className="benefits-window-grid">
            <label className="benefits-field">
              <span>From year</span>
              <input inputMode="numeric" value={addDraft.effectiveFromYear} onChange={(event) => setAddDraft({ effectiveFromYear: event.target.value })} placeholder="—" />
            </label>
            <label className="benefits-field">
              <span>From period</span>
              <select value={addDraft.effectiveFromPeriod} onChange={(event) => setAddDraft({ effectiveFromPeriod: event.target.value })}>
                <option value="">Start of year</option>
                {periodKeysForCadence(addDraft.cadence).map((key) => (
                  <option key={key} value={key}>{key === "Y" ? "Year" : key}</option>
                ))}
              </select>
            </label>
            <label className="benefits-field">
              <span>To year</span>
              <input inputMode="numeric" value={addDraft.effectiveToYear} onChange={(event) => setAddDraft({ effectiveToYear: event.target.value })} placeholder="—" />
            </label>
            <label className="benefits-field">
              <span>To period</span>
              <select value={addDraft.effectiveToPeriod} onChange={(event) => setAddDraft({ effectiveToPeriod: event.target.value })}>
                <option value="">End of year</option>
                {periodKeysForCadence(addDraft.cadence).map((key) => (
                  <option key={key} value={key}>{key === "Y" ? "Year" : key}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="template-editor-item-actions">
            <button className="button primary small" type="button" disabled={busy || !addDraft.name.trim()} onClick={onAddBenefit}>
              <Plus aria-hidden="true" /> Add
            </button>
          </div>
        </article>
      </div>

      <button className="button ghost small template-editor-delete" type="button" disabled={busy} onClick={onDelete}>
        Delete template
      </button>
    </div>
  );
}

function BenefitCardThumb({ account, compact = false }: { account: CreditAccount; compact?: boolean }) {
  const art = resolveCardArt({
    name: account.name,
    officialName: account.officialName,
    institutionName: account.institutionName,
    mask: account.mask,
    type: account.type ?? "credit",
  });
  if (art) {
    return <img className={compact ? "benefits-card-art compact" : "benefits-card-art"} src={art.src} alt="" />;
  }
  return (
    <div
      className={compact ? "institution-monogram compact" : "institution-monogram"}
      style={account.institutionPrimaryColor ? { backgroundColor: account.institutionPrimaryColor } : undefined}
    >
      {account.institutionLogo ? <img src={account.institutionLogo} alt="" /> : initials(account.name)}
    </div>
  );
}
