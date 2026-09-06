import { and, like, ne } from "drizzle-orm";
import { getDb } from "../../../../db";
import { transactions } from "../../../../db/schema";

const MAX_MATCHES = 200;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pattern = (url.searchParams.get("pattern") ?? "").trim();
    const excludeId = url.searchParams.get("excludeId") ?? "";
    if (!pattern) return Response.json({ matches: [] });

    const db = getDb();
    const rows = await db
      .select({
        transactionId: transactions.transactionId,
        name: transactions.name,
        merchantName: transactions.merchantName,
        date: transactions.date,
        amountMilliunits: transactions.amountMilliunits,
        categoryPrimary: transactions.categoryPrimary,
      })
      .from(transactions)
      .where(and(like(transactions.name, `%${pattern}%`), ne(transactions.transactionId, excludeId)))
      .orderBy(transactions.date)
      .limit(MAX_MATCHES);

    return Response.json({ matches: rows });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to search transactions." },
      { status: 500 },
    );
  }
}
