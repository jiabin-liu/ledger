import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { benefitDefs, benefitPeriods } from "../db/schema";
import { ensurePeriodsForYear } from "./benefits";
import {
  BENEFIT_CADENCES,
  isPeriodInWindow,
  periodKeysForCadence,
  type BenefitCadence,
  type BenefitWindow,
} from "./benefits-shared";

const now = () => new Date().toISOString();

export type ParsedBenefitInput = {
  name: string;
  amountMilliunits: number;
  cadence: BenefitCadence;
  effectiveFromYear: number | null;
  effectiveFromPeriod: string | null;
  effectiveToYear: number | null;
  effectiveToPeriod: string | null;
};

type RawBenefitInput = {
  name?: string;
  amountDollars?: number;
  cadence?: string;
  effectiveFromYear?: number | null;
  effectiveFromPeriod?: string | null;
  effectiveToYear?: number | null;
  effectiveToPeriod?: string | null;
};

function parseOptionalYear(value: unknown, label: string) {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a year number.`);
  }
  return Math.trunc(value);
}

function parseOptionalPeriod(cadence: string, value: unknown, label: string) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !periodKeysForCadence(cadence).includes(value)) {
    throw new Error(`${label} must match the benefit cadence.`);
  }
  return value;
}

export function parseBenefitInput(raw: RawBenefitInput, label = "Benefit"): ParsedBenefitInput {
  const name = raw.name?.trim();
  if (!name) throw new Error(`${label} needs a name.`);
  if (typeof raw.amountDollars !== "number" || !Number.isFinite(raw.amountDollars) || raw.amountDollars < 0) {
    throw new Error(`Benefit "${name}" needs a valid dollar amount.`);
  }
  if (!BENEFIT_CADENCES.includes(raw.cadence as BenefitCadence)) {
    throw new Error(`Benefit "${name}" needs a valid cadence.`);
  }
  const cadence = raw.cadence as BenefitCadence;
  const effectiveFromYear = parseOptionalYear(raw.effectiveFromYear, `Benefit "${name}" from year`);
  const effectiveToYear = parseOptionalYear(raw.effectiveToYear, `Benefit "${name}" to year`);
  const effectiveFromPeriod = parseOptionalPeriod(cadence, raw.effectiveFromPeriod, `Benefit "${name}" from period`);
  const effectiveToPeriod = parseOptionalPeriod(cadence, raw.effectiveToPeriod, `Benefit "${name}" to period`);
  if (effectiveFromPeriod && effectiveFromYear == null) {
    throw new Error(`Benefit "${name}" from period needs a from year.`);
  }
  if (effectiveToPeriod && effectiveToYear == null) {
    throw new Error(`Benefit "${name}" to period needs a to year.`);
  }
  return {
    name,
    amountMilliunits: Math.round(raw.amountDollars * 1000),
    cadence,
    effectiveFromYear,
    effectiveFromPeriod,
    effectiveToYear,
    effectiveToPeriod,
  };
}

export function parseBenefitsList(raw: unknown): ParsedBenefitInput[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("Add at least one benefit.");
  return raw.map((item, index) => parseBenefitInput(item as RawBenefitInput, `Benefit #${index + 1}`));
}

export async function findUsedPeriodsOutsideWindow(defId: number, window: BenefitWindow) {
  const db = getDb();
  const rows = await db
    .select({
      id: benefitPeriods.id,
      accountId: benefitPeriods.accountId,
      year: benefitPeriods.year,
      periodKey: benefitPeriods.periodKey,
      status: benefitPeriods.status,
    })
    .from(benefitPeriods)
    .where(eq(benefitPeriods.benefitDefId, defId));

  return rows.filter(
    (row) => row.status === "used" && !isPeriodInWindow(window, row.year, row.periodKey),
  );
}

export async function syncPeriodsForBenefit(defId: number, preferredYear?: number) {
  const db = getDb();
  const years = new Set<number>();
  if (preferredYear != null) years.add(preferredYear);
  years.add(new Date().getFullYear());
  const existing = await db
    .select({ year: benefitPeriods.year })
    .from(benefitPeriods)
    .where(eq(benefitPeriods.benefitDefId, defId));
  for (const row of existing) years.add(row.year);
  for (const year of years) await ensurePeriodsForYear(year);
}

export async function insertBenefitDef(productId: number, benefit: ParsedBenefitInput, sortOrder: number) {
  const db = getDb();
  const timestamp = now();
  const created = await db.insert(benefitDefs).values({
    productId,
    name: benefit.name,
    amountMilliunits: benefit.amountMilliunits,
    cadence: benefit.cadence,
    effectiveFromYear: benefit.effectiveFromYear,
    effectiveFromPeriod: benefit.effectiveFromPeriod,
    effectiveToYear: benefit.effectiveToYear,
    effectiveToPeriod: benefit.effectiveToPeriod,
    sortOrder,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).returning();
  return created[0];
}
