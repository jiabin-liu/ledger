import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import {
  benefitAssignments,
  benefitDefs,
  benefitPeriods,
  cardProducts,
} from "../../../../../db/schema";

const now = () => new Date().toISOString();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const productId = Number.parseInt(rawId, 10);
    if (!Number.isFinite(productId)) {
      return Response.json({ error: "Invalid template id." }, { status: 400 });
    }

    const payload = await request.json() as { name?: string };
    const name = payload.name?.trim();
    if (!name) return Response.json({ error: "Template name is required." }, { status: 400 });

    const db = getDb();
    const product = await db
      .select({ id: cardProducts.id })
      .from(cardProducts)
      .where(eq(cardProducts.id, productId))
      .limit(1);
    if (!product[0]) return Response.json({ error: "Template not found." }, { status: 404 });

    const updatedAt = now();
    await db.update(cardProducts).set({ name, updatedAt }).where(eq(cardProducts.id, productId));
    return Response.json({ product: { id: productId, name, updatedAt } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to rename template." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const productId = Number.parseInt(rawId, 10);
    if (!Number.isFinite(productId)) {
      return Response.json({ error: "Invalid template id." }, { status: 400 });
    }

    const db = getDb();
    const product = await db
      .select({ id: cardProducts.id })
      .from(cardProducts)
      .where(eq(cardProducts.id, productId))
      .limit(1);
    if (!product[0]) return Response.json({ error: "Template not found." }, { status: 404 });

    const defs = await db
      .select({ id: benefitDefs.id })
      .from(benefitDefs)
      .where(eq(benefitDefs.productId, productId));
    const assignments = await db
      .select({ accountId: benefitAssignments.accountId })
      .from(benefitAssignments)
      .where(eq(benefitAssignments.productId, productId));

    for (const def of defs) {
      await db.delete(benefitPeriods).where(eq(benefitPeriods.benefitDefId, def.id));
    }
    for (const assignment of assignments) {
      await db.delete(benefitPeriods).where(eq(benefitPeriods.accountId, assignment.accountId));
      await db.delete(benefitAssignments).where(eq(benefitAssignments.accountId, assignment.accountId));
    }
    await db.delete(benefitDefs).where(eq(benefitDefs.productId, productId));
    await db.delete(cardProducts).where(eq(cardProducts.id, productId));

    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to delete template." },
      { status: 500 },
    );
  }
}
