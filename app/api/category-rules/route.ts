import { createCategoryRule, listCategoryRules } from "../../../lib/category-rules";

export async function GET() {
  try {
    const rules = await listCategoryRules();
    return Response.json({ rules });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load category rules." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { pattern?: unknown; categoryPrimary?: unknown };
    if (typeof body.pattern !== "string" || typeof body.categoryPrimary !== "string") {
      return Response.json({ error: "pattern and categoryPrimary are required." }, { status: 400 });
    }

    const { rule, updated } = await createCategoryRule(body.pattern, body.categoryPrimary);
    return Response.json({ rule, updated });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to create category rule." },
      { status: 400 },
    );
  }
}
