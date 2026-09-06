import { getSpendingSummary, type InsightsMode } from "../../../lib/insights";

function parseMode(raw: string | null): InsightsMode {
  return raw === "month" || raw === "year" || raw === "last12" ? raw : "month";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mode = parseMode(url.searchParams.get("mode"));
    const now = new Date();
    const yearParam = Number.parseInt(url.searchParams.get("year") ?? "", 10);
    const monthParam = Number.parseInt(url.searchParams.get("month") ?? "", 10);
    const year = Number.isFinite(yearParam) ? yearParam : now.getUTCFullYear();
    const month = Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12
      ? monthParam
      : now.getUTCMonth() + 1;
    const summary = await getSpendingSummary(mode, year, month);
    return Response.json(summary);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load spending insights." },
      { status: 500 },
    );
  }
}
