import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { benefitDefs } from "../../../../../db/schema";
import { findUsedPeriodsOutsideWindow, syncPeriodsForBenefit } from "../../../../../lib/benefit-defs";
import { periodKeysForCadence } from "../../../../../lib/benefits-shared";

const now = () => new Date().toISOString();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const defId = Number.parseInt(rawId, 10);
    if (!Number.isFinite(defId)) {
      return Response.json({ error: "Invalid benefit id." }, { status: 400 });
    }

    const payload = await request.json() as {
      name?: string;
      effectiveFromYear?: number | null;
      effectiveFromPeriod?: string | null;
      effectiveToYear?: number | null;
      effectiveToPeriod?: string | null;
      year?: number;
    };

    const db = getDb();
    const existing = await db.select().from(benefitDefs).where(eq(benefitDefs.id, defId)).limit(1);
    const def = existing[0];
    if (!def) return Response.json({ error: "Benefit not found." }, { status: 404 });

    const name = payload.name !== undefined ? payload.name.trim() : def.name;
    if (!name) return Response.json({ error: "Benefit name is required." }, { status: 400 });

    const fromYear = payload.effectiveFromYear === undefined ? def.effectiveFromYear : payload.effectiveFromYear;
    const toYear = payload.effectiveToYear === undefined ? def.effectiveToYear : payload.effectiveToYear;
    const fromPeriod = payload.effectiveFromPeriod === undefined
      ? def.effectiveFromPeriod
      : payload.effectiveFromPeriod;
    const toPeriod = payload.effectiveToPeriod === undefined
      ? def.effectiveToPeriod
      : payload.effectiveToPeriod;

    const keys = periodKeysForCadence(def.cadence);
    if (fromPeriod && !keys.includes(fromPeriod)) {
      return Response.json({ error: "From period does not match cadence." }, { status: 400 });
    }
    if (toPeriod && !keys.includes(toPeriod)) {
      return Response.json({ error: "To period does not match cadence." }, { status: 400 });
    }
    if (fromPeriod && fromYear == null) {
      return Response.json({ error: "From period needs a from year." }, { status: 400 });
    }
    if (toPeriod && toYear == null) {
      return Response.json({ error: "To period needs a to year." }, { status: 400 });
    }

    const nextWindow = {
      cadence: def.cadence,
      effectiveFromYear: fromYear,
      effectiveFromPeriod: fromPeriod,
      effectiveToYear: toYear,
      effectiveToPeriod: toPeriod,
    };
    const conflicts = await findUsedPeriodsOutsideWindow(defId, nextWindow);
    if (conflicts.length > 0) {
      const sample = conflicts
        .slice(0, 3)
        .map((row) => `${row.year} ${row.periodKey}`)
        .join(", ");
      return Response.json(
        {
          error: `Cannot shrink this window: ${conflicts.length} used period${conflicts.length === 1 ? "" : "s"} would be removed (${sample}${conflicts.length > 3 ? ", …" : ""}). Undo those Used marks first, or keep them inside the window.`,
          conflicts: conflicts.map((row) => ({
            accountId: row.accountId,
            year: row.year,
            periodKey: row.periodKey,
          })),
        },
        { status: 409 },
      );
    }

    const updatedAt = now();
    await db.update(benefitDefs).set({
      name,
      effectiveFromYear: fromYear,
      effectiveFromPeriod: fromPeriod,
      effectiveToYear: toYear,
      effectiveToPeriod: toPeriod,
      updatedAt,
    }).where(eq(benefitDefs.id, defId));

    const year = payload.year && Number.isFinite(payload.year) ? payload.year : new Date().getFullYear();
    await syncPeriodsForBenefit(defId, year);

    const updated = await db.select().from(benefitDefs).where(eq(benefitDefs.id, defId)).limit(1);
    return Response.json({ def: updated[0] });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update benefit." },
      { status: 500 },
    );
  }
}
