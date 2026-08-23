import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { accounts, plaidItems } from "../../../../db/schema";
import { isAmexInstitution } from "../../../../lib/account-display";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { accountId?: unknown; displayMask?: unknown };
    if (typeof body.accountId !== "string" || body.accountId.length === 0) {
      return Response.json({ error: "accountId is required." }, { status: 400 });
    }

    let displayMask: string | null;
    if (body.displayMask === null || body.displayMask === undefined || body.displayMask === "") {
      displayMask = null;
    } else if (typeof body.displayMask === "string" && /^\d{5}$/.test(body.displayMask)) {
      displayMask = body.displayMask;
    } else {
      return Response.json({ error: "displayMask must be exactly 5 digits, or empty to clear." }, { status: 400 });
    }

    const db = getDb();
    const rows = await db
      .select({
        accountId: accounts.accountId,
        type: accounts.type,
        institutionName: plaidItems.institutionName,
      })
      .from(accounts)
      .leftJoin(plaidItems, eq(accounts.itemId, plaidItems.itemId))
      .where(eq(accounts.accountId, body.accountId))
      .limit(1);

    const account = rows[0];
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }
    if (account.type !== "credit" || !isAmexInstitution(account.institutionName)) {
      return Response.json({ error: "Last-5 override is only available for Amex credit cards." }, { status: 400 });
    }

    await db
      .update(accounts)
      .set({ displayMask, updatedAt: new Date().toISOString() })
      .where(eq(accounts.accountId, body.accountId));

    return Response.json({ accountId: body.accountId, displayMask });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save display mask." },
      { status: 500 },
    );
  }
}
