import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { benefitPeriods } from "../../../../db/schema";
import { BENEFIT_STATUSES, type BenefitStatus } from "../../../../lib/benefits-shared";

const now = () => new Date().toISOString();

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as { id?: number; status?: string };
    if (!payload.id) return Response.json({ error: "Period id is required." }, { status: 400 });
    if (!BENEFIT_STATUSES.includes(payload.status as BenefitStatus)) {
      return Response.json({ error: "Invalid status." }, { status: 400 });
    }
    const db = getDb();
    const existing = await db
      .select({ id: benefitPeriods.id })
      .from(benefitPeriods)
      .where(eq(benefitPeriods.id, payload.id))
      .limit(1);
    if (!existing[0]) return Response.json({ error: "Period not found." }, { status: 404 });

    const updatedAt = now();
    await db
      .update(benefitPeriods)
      .set({ status: payload.status as BenefitStatus, updatedAt })
      .where(eq(benefitPeriods.id, payload.id));

    return Response.json({ id: payload.id, status: payload.status, updatedAt });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update period." },
      { status: 500 },
    );
  }
}
