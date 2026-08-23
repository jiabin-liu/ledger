import { getDb } from "../../../../db";
import { plaidItems } from "../../../../db/schema";
import { syncItem } from "../../../../lib/sync";

export async function POST() {
  try {
    const items = await getDb().select().from(plaidItems);
    let added = 0;
    for (const item of items) added += await syncItem(item);
    return Response.json({ added, institutions: items.length });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to sync transactions." },
      { status: 500 },
    );
  }
}
