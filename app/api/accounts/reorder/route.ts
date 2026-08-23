import { env } from "cloudflare:workers";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { accountIds?: unknown };
    if (!Array.isArray(body.accountIds) || body.accountIds.length === 0) {
      return Response.json({ error: "A non-empty account order is required." }, { status: 400 });
    }

    const accountIds = body.accountIds.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (accountIds.length !== body.accountIds.length || new Set(accountIds).size !== accountIds.length) {
      return Response.json({ error: "Account order contains invalid or duplicate IDs." }, { status: 400 });
    }

    await env.DB.batch(accountIds.map((accountId, index) =>
      env.DB.prepare("UPDATE accounts SET sort_order = ? WHERE account_id = ?")
        .bind(index, accountId),
    ));
    return Response.json({ saved: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save account order." },
      { status: 500 },
    );
  }
}
