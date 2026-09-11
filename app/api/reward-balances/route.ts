import { asc, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { rewardBalances } from "../../../db/schema";

const now = () => new Date().toISOString();

export async function GET() {
  try {
    const rows = await getDb().select().from(rewardBalances).orderBy(asc(rewardBalances.sortOrder), asc(rewardBalances.id));
    return Response.json({ rows });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load reward balances." },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const db = getDb();
    const maxSortOrderRows = await db
      .select({ maxSortOrder: sql<number | null>`max(${rewardBalances.sortOrder})` })
      .from(rewardBalances);
    const nextSortOrder = (maxSortOrderRows[0]?.maxSortOrder ?? -1) + 1;
    const timestamp = now();
    const inserted = await db.insert(rewardBalances).values({
      name: null,
      remainingAmount: null,
      expirationDate: null,
      sortOrder: nextSortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).returning();

    return Response.json({ row: inserted[0] });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to create reward balance." },
      { status: 500 },
    );
  }
}
