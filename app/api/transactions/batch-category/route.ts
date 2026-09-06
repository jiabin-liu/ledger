import { inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { transactions } from "../../../../db/schema";
import { isPlaidPrimaryCategory } from "../../../../lib/categories";

const MAX_BATCH = 200;

export async function POST(request: Request) {
  try {
    const body = await request.json() as { transactionIds?: unknown; categoryPrimary?: unknown };
    if (!Array.isArray(body.transactionIds) || body.transactionIds.length === 0) {
      return Response.json({ error: "transactionIds must be a non-empty array." }, { status: 400 });
    }
    const ids = body.transactionIds.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length === 0) {
      return Response.json({ error: "transactionIds must be a non-empty array." }, { status: 400 });
    }
    if (ids.length > MAX_BATCH) {
      return Response.json({ error: `Cannot update more than ${MAX_BATCH} transactions at once.` }, { status: 400 });
    }
    if (!isPlaidPrimaryCategory(body.categoryPrimary)) {
      return Response.json({ error: "categoryPrimary is not a recognized category." }, { status: 400 });
    }

    const db = getDb();
    await db
      .update(transactions)
      .set({ categoryPrimary: body.categoryPrimary, categoryDetailed: null, updatedAt: new Date().toISOString() })
      .where(inArray(transactions.transactionId, ids));

    return Response.json({ updated: ids.length, categoryPrimary: body.categoryPrimary });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update transactions." },
      { status: 500 },
    );
  }
}
