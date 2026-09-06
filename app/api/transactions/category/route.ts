import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { transactions } from "../../../../db/schema";
import { isPlaidPrimaryCategory } from "../../../../lib/categories";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { transactionId?: unknown; categoryPrimary?: unknown };
    if (typeof body.transactionId !== "string" || body.transactionId.length === 0) {
      return Response.json({ error: "transactionId is required." }, { status: 400 });
    }
    if (!isPlaidPrimaryCategory(body.categoryPrimary)) {
      return Response.json({ error: "categoryPrimary is not a recognized category." }, { status: 400 });
    }

    const db = getDb();
    const existing = await db
      .select({ transactionId: transactions.transactionId })
      .from(transactions)
      .where(eq(transactions.transactionId, body.transactionId))
      .limit(1);
    if (!existing[0]) {
      return Response.json({ error: "Transaction not found." }, { status: 404 });
    }

    await db
      .update(transactions)
      .set({ categoryPrimary: body.categoryPrimary, categoryDetailed: null, updatedAt: new Date().toISOString() })
      .where(eq(transactions.transactionId, body.transactionId));

    return Response.json({ transactionId: body.transactionId, categoryPrimary: body.categoryPrimary });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save category." },
      { status: 500 },
    );
  }
}
