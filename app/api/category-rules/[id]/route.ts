import { deleteCategoryRule } from "../../../../lib/category-rules";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = Number.parseInt(rawId, 10);
    if (!Number.isFinite(id)) {
      return Response.json({ error: "Invalid rule id." }, { status: 400 });
    }

    await deleteCategoryRule(id);
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to delete category rule." },
      { status: 500 },
    );
  }
}
