import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { benefitAssignments, benefitDefs, benefitPeriods, cardProducts } from "../db/schema";
import { activePeriodKeysForYear, isBenefitActiveInYear } from "./benefits-shared";

export {
  BENEFIT_CADENCES,
  BENEFIT_STATUSES,
  activePeriodKeysForYear,
  cadenceLabel,
  formatBenefitWindow,
  isBenefitActiveInYear,
  periodKeysForCadence,
  type BenefitCadence,
  type BenefitStatus,
} from "./benefits-shared";

const now = () => new Date().toISOString();

export async function listBenefitBundle(year: number) {
  const db = getDb();
  const [products, defs, assignments, periods] = await Promise.all([
    db.select().from(cardProducts).orderBy(asc(cardProducts.name)),
    db.select().from(benefitDefs).orderBy(asc(benefitDefs.sortOrder), asc(benefitDefs.id)),
    db.select().from(benefitAssignments),
    db.select().from(benefitPeriods).where(eq(benefitPeriods.year, year)),
  ]);
  return { products, defs, assignments, periods, year };
}

/** Insert missing period rows for assigned accounts in a calendar year. Never touches other tables. */
export async function ensurePeriodsForYear(year: number, accountId?: string) {
  const db = getDb();
  const assignmentRows = accountId
    ? await db.select().from(benefitAssignments).where(eq(benefitAssignments.accountId, accountId))
    : await db.select().from(benefitAssignments);
  if (assignmentRows.length === 0) return 0;

  const defs = await db.select().from(benefitDefs);
  const defsByProduct = new Map<number, typeof defs>();
  for (const def of defs) {
    const list = defsByProduct.get(def.productId) ?? [];
    list.push(def);
    defsByProduct.set(def.productId, list);
  }

  const timestamp = now();
  let inserted = 0;
  for (const assignment of assignmentRows) {
    const productDefs = defsByProduct.get(assignment.productId) ?? [];
    for (const def of productDefs) {
      if (!isBenefitActiveInYear(def, year)) {
        // Drop any stale periods outside the benefit window for this year.
        await db.delete(benefitPeriods).where(
          and(
            eq(benefitPeriods.accountId, assignment.accountId),
            eq(benefitPeriods.benefitDefId, def.id),
            eq(benefitPeriods.year, year),
          ),
        );
        continue;
      }
      const activeKeys = activePeriodKeysForYear(def, year);
      const existingRows = await db
        .select({ id: benefitPeriods.id, periodKey: benefitPeriods.periodKey })
        .from(benefitPeriods)
        .where(
          and(
            eq(benefitPeriods.accountId, assignment.accountId),
            eq(benefitPeriods.benefitDefId, def.id),
            eq(benefitPeriods.year, year),
          ),
        );
      for (const row of existingRows) {
        if (!activeKeys.includes(row.periodKey)) {
          await db.delete(benefitPeriods).where(eq(benefitPeriods.id, row.id));
        }
      }
      const existingKeys = new Set(existingRows.map((row) => row.periodKey));
      for (const periodKey of activeKeys) {
        if (existingKeys.has(periodKey)) continue;
        await db.insert(benefitPeriods).values({
          accountId: assignment.accountId,
          benefitDefId: def.id,
          year,
          periodKey,
          status: "available",
          note: null,
          updatedAt: timestamp,
        });
        inserted += 1;
      }
    }
  }
  return inserted;
}
