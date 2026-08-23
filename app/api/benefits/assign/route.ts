import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { accounts, benefitAssignments, benefitPeriods, cardProducts } from "../../../../db/schema";
import { ensurePeriodsForYear } from "../../../../lib/benefits";

const now = () => new Date().toISOString();

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { accountId?: string; productId?: number; year?: number };
    if (!payload.accountId || !payload.productId) {
      return Response.json({ error: "accountId and productId are required." }, { status: 400 });
    }
    const year = payload.year && Number.isFinite(payload.year) ? payload.year : new Date().getFullYear();
    const db = getDb();

    const account = await db
      .select({ accountId: accounts.accountId, type: accounts.type })
      .from(accounts)
      .where(eq(accounts.accountId, payload.accountId))
      .limit(1);
    if (!account[0]) return Response.json({ error: "Account not found." }, { status: 404 });
    if (account[0].type !== "credit") {
      return Response.json({ error: "Only credit accounts can track benefits." }, { status: 400 });
    }

    const product = await db
      .select({ id: cardProducts.id })
      .from(cardProducts)
      .where(eq(cardProducts.id, payload.productId))
      .limit(1);
    if (!product[0]) return Response.json({ error: "Template not found." }, { status: 404 });

    const timestamp = now();
    const existing = await db
      .select()
      .from(benefitAssignments)
      .where(eq(benefitAssignments.accountId, payload.accountId))
      .limit(1);

    if (existing[0]) {
      if (existing[0].productId !== payload.productId) {
        // Changing template: clear only this account's period rows, then reassign.
        await db.delete(benefitPeriods).where(eq(benefitPeriods.accountId, payload.accountId));
        await db
          .update(benefitAssignments)
          .set({ productId: payload.productId, updatedAt: timestamp })
          .where(eq(benefitAssignments.accountId, payload.accountId));
      }
    } else {
      await db.insert(benefitAssignments).values({
        accountId: payload.accountId,
        productId: payload.productId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    await ensurePeriodsForYear(year, payload.accountId);
    const assignment = await db
      .select()
      .from(benefitAssignments)
      .where(eq(benefitAssignments.accountId, payload.accountId))
      .limit(1);
    return Response.json({ assignment: assignment[0], year });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to assign template." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = await request.json() as { accountId?: string };
    if (!payload.accountId) return Response.json({ error: "accountId is required." }, { status: 400 });
    const db = getDb();
    await db.delete(benefitPeriods).where(eq(benefitPeriods.accountId, payload.accountId));
    await db.delete(benefitAssignments).where(eq(benefitAssignments.accountId, payload.accountId));
    return Response.json({ removed: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to unassign template." },
      { status: 500 },
    );
  }
}
