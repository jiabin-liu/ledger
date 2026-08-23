import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { transactions } from "../../../../db/schema";

const MAX_NOTE_LENGTH = 500;

export async function POST(request: Request) {
  try {
    const body = await request.json() as { transactionId?: unknown; note?: unknown };
    if (typeof body.transactionId !== "string" || body.transactionId.length === 0) {
      return Response.json({ error: "transactionId is required." }, { status: 400 });
    }

    let note: string | null;
    if (body.note === null || body.note === undefined) {
      note = null;
    } else if (typeof body.note === "string") {
      const trimmed = body.note.trim();
      if (trimmed.length > MAX_NOTE_LENGTH) {
        return Response.json({ error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer.` }, { status: 400 });
      }
      note = trimmed.length === 0 ? null : trimmed;
    } else {
      return Response.json({ error: "note must be a string or null." }, { status: 400 });
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
      .set({ note, updatedAt: new Date().toISOString() })
      .where(eq(transactions.transactionId, body.transactionId));

    return Response.json({ transactionId: body.transactionId, note });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save note." },
      { status: 500 },
    );
  }
}
