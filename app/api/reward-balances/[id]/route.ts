import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { rewardBalances } from "../../../../db/schema";

const MAX_NAME_LENGTH = 200;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = Number.parseInt(rawId, 10);
    if (!Number.isFinite(id)) {
      return Response.json({ error: "Invalid reward balance id." }, { status: 400 });
    }

    const body = await request.json() as { name?: unknown; remainingAmount?: unknown; expirationDate?: unknown };
    const updates: Partial<typeof rewardBalances.$inferInsert> = {};

    if ("name" in body) {
      if (body.name === null) {
        updates.name = null;
      } else if (typeof body.name === "string") {
        const trimmed = body.name.trim();
        if (trimmed.length > MAX_NAME_LENGTH) {
          return Response.json({ error: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` }, { status: 400 });
        }
        updates.name = trimmed.length === 0 ? null : trimmed;
      } else {
        return Response.json({ error: "name must be a string or null." }, { status: 400 });
      }
    }

    if ("remainingAmount" in body) {
      if (body.remainingAmount === null) {
        updates.remainingAmount = null;
      } else if (typeof body.remainingAmount === "number" && Number.isFinite(body.remainingAmount)) {
        updates.remainingAmount = body.remainingAmount;
      } else {
        return Response.json({ error: "remainingAmount must be a number or null." }, { status: 400 });
      }
    }

    if ("expirationDate" in body) {
      if (body.expirationDate === null) {
        updates.expirationDate = null;
      } else if (typeof body.expirationDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expirationDate)) {
        updates.expirationDate = body.expirationDate;
      } else {
        return Response.json({ error: "expirationDate must be a YYYY-MM-DD string or null." }, { status: 400 });
      }
    }

    const db = getDb();
    const existing = await db.select().from(rewardBalances).where(eq(rewardBalances.id, id)).limit(1);
    if (!existing[0]) return Response.json({ error: "Reward balance not found." }, { status: 404 });

    const updated = await db
      .update(rewardBalances)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(rewardBalances.id, id))
      .returning();

    return Response.json({ row: updated[0] });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update reward balance." },
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
    const id = Number.parseInt(rawId, 10);
    if (!Number.isFinite(id)) {
      return Response.json({ error: "Invalid reward balance id." }, { status: 400 });
    }

    await getDb().delete(rewardBalances).where(eq(rewardBalances.id, id));
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to delete reward balance." },
      { status: 500 },
    );
  }
}
