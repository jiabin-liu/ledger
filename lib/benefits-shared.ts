export type BenefitCadence = "monthly" | "quarterly" | "semi_annual" | "annual";
export type BenefitStatus = "available" | "used" | "missed" | "n/a";

export const BENEFIT_CADENCES: BenefitCadence[] = ["monthly", "quarterly", "semi_annual", "annual"];
export const BENEFIT_STATUSES: BenefitStatus[] = ["available", "used", "missed", "n/a"];

export type BenefitWindow = {
  effectiveFromYear: number | null;
  effectiveFromPeriod: string | null;
  effectiveToYear: number | null;
  effectiveToPeriod: string | null;
  cadence: string;
};

export function periodKeysForCadence(cadence: string): string[] {
  switch (cadence) {
    case "monthly":
      return ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10", "M11", "M12"];
    case "quarterly":
      return ["Q1", "Q2", "Q3", "Q4"];
    case "semi_annual":
      return ["H1", "H2"];
    case "annual":
      return ["Y"];
    default:
      return [];
  }
}

export function periodIndex(cadence: string, periodKey: string | null | undefined) {
  if (!periodKey) return -1;
  return periodKeysForCadence(cadence).indexOf(periodKey);
}

export function isBenefitActiveInYear(def: BenefitWindow, year: number) {
  return activePeriodKeysForYear(def, year).length > 0;
}

/** Periods that should exist for this benefit in a calendar year (respects mid-year start/end). */
export function activePeriodKeysForYear(def: BenefitWindow, year: number): string[] {
  const keys = periodKeysForCadence(def.cadence);
  if (keys.length === 0) return [];

  return keys.filter((periodKey) => isPeriodInWindow(def, year, periodKey));
}

export function isPeriodInWindow(def: BenefitWindow, year: number, periodKey: string) {
  const keys = periodKeysForCadence(def.cadence);
  const index = keys.indexOf(periodKey);
  if (index < 0) return false;

  if (def.effectiveFromYear != null) {
    if (year < def.effectiveFromYear) return false;
    if (year === def.effectiveFromYear) {
      const fromIndex = def.effectiveFromPeriod
        ? periodIndex(def.cadence, def.effectiveFromPeriod)
        : 0;
      if (fromIndex >= 0 && index < fromIndex) return false;
    }
  }

  if (def.effectiveToYear != null) {
    if (year > def.effectiveToYear) return false;
    if (year === def.effectiveToYear) {
      const toIndex = def.effectiveToPeriod
        ? periodIndex(def.cadence, def.effectiveToPeriod)
        : keys.length - 1;
      if (toIndex >= 0 && index > toIndex) return false;
    }
  }

  return true;
}

export function cadenceLabel(cadence: string) {
  switch (cadence) {
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "semi_annual":
      return "Semi-annual";
    case "annual":
      return "Annual";
    default:
      return cadence;
  }
}

export function formatBenefitWindow(def: BenefitWindow) {
  const from = def.effectiveFromYear != null
    ? `${def.effectiveFromYear}${def.effectiveFromPeriod ? ` ${def.effectiveFromPeriod}` : ""}`
    : null;
  const to = def.effectiveToYear != null
    ? `${def.effectiveToYear}${def.effectiveToPeriod ? ` ${def.effectiveToPeriod}` : ""}`
    : null;
  if (!from && !to) return "No date limit";
  if (from && to) return `${from} → ${to}`;
  if (from) return `From ${from}`;
  return `Through ${to}`;
}
