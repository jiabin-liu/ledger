import { ensurePeriodsForYear, listBenefitBundle } from "../../../lib/benefits";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const yearParam = Number.parseInt(url.searchParams.get("year") ?? "", 10);
    const year = Number.isFinite(yearParam) ? yearParam : new Date().getFullYear();
    await ensurePeriodsForYear(year);
    const bundle = await listBenefitBundle(year);
    return Response.json(bundle);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load benefits." },
      { status: 500 },
    );
  }
}
