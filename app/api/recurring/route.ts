import { getRecurringExpenses } from "../../../lib/recurring";

export async function GET() {
  try {
    const groups = await getRecurringExpenses();
    return Response.json({ groups });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load recurring expenses." },
      { status: 500 },
    );
  }
}
