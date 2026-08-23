import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { benefitAssignments, benefitDefs, cardProducts } from "../../../../../../db/schema";
import { insertBenefitDef, parseBenefitInput, syncPeriodsForBenefit } from "../../../../../../lib/benefit-defs";
import { ensurePeriodsForYear } from "../../../../../../lib/benefits";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const productId = Number.parseInt(rawId, 10);
    if (!Number.isFinite(productId)) {
      return Response.json({ error: "Invalid template id." }, { status: 400 });
    }

    const payload = await request.json() as Record<string, unknown>;
    const benefit = parseBenefitInput(payload);
    const year = typeof payload.year === "number" && Number.isFinite(payload.year)
      ? payload.year
      : new Date().getFullYear();

    const db = getDb();
    const product = await db
      .select({ id: cardProducts.id })
      .from(cardProducts)
      .where(eq(cardProducts.id, productId))
      .limit(1);
    if (!product[0]) return Response.json({ error: "Template not found." }, { status: 404 });

    const existing = await db
      .select({ sortOrder: benefitDefs.sortOrder })
      .from(benefitDefs)
      .where(eq(benefitDefs.productId, productId))
      .orderBy(asc(benefitDefs.sortOrder));
    const nextOrder = (existing[existing.length - 1]?.sortOrder ?? -1) + 1;
    const created = await insertBenefitDef(productId, benefit, nextOrder);
    if (!created) throw new Error("Unable to add benefit.");

    const assignments = await db
      .select({ accountId: benefitAssignments.accountId })
      .from(benefitAssignments)
      .where(eq(benefitAssignments.productId, productId));
    for (const assignment of assignments) {
      await ensurePeriodsForYear(year, assignment.accountId);
    }
    await syncPeriodsForBenefit(created.id, year);

    return Response.json({ def: created });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to add benefit." },
      { status: 500 },
    );
  }
}
