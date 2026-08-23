import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { transactions } from "../../../../db/schema";
import { isTriageStatus } from "../../../../lib/triage";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { transactionId?: unknown; triage?: unknown };
    if (typeof body.transactionId !== "string" || body.transactionId.length === 0) {
      return Response.json({ error: "transactionId is required." }, { status: 400 });
    }
    if (!isTriageStatus(body.triage)) {
      return Response.json({ error: "triage must be untriaged, recognized, or questioned." }, { status: 400 });
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
      .set({ triage: body.triage, updatedAt: new Date().toISOString() })
      .where(eq(transactions.transactionId, body.transactionId));

    return Response.json({ transactionId: body.transactionId, triage: body.triage });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save triage." },
      { status: 500 },
    );
  }
}
