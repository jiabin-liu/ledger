import { getCardSpendSummary } from "../../../lib/card-spend";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId")?.trim();
    if (!accountId) {
      return Response.json({ error: "accountId is required." }, { status: 400 });
    }
    const summary = await getCardSpendSummary(accountId);
    return Response.json(summary);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load card spend." },
      { status: 500 },
    );
  }
}
