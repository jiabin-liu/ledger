import { env } from "cloudflare:workers";
import { getInstitutionBrand } from "../../../../../lib/plaid";

export async function POST() {
  try {
    const rows = await env.DB.prepare(
      "SELECT item_id, institution_id FROM plaid_items WHERE institution_id IS NOT NULL",
    ).all<{ item_id: string; institution_id: string }>();
    let updated = 0;
    for (const row of rows.results ?? []) {
      const brand = await getInstitutionBrand(row.institution_id);
      await env.DB.prepare(
        "UPDATE plaid_items SET institution_logo = ?, institution_primary_color = ? WHERE item_id = ?",
      ).bind(brand.logo, brand.primaryColor, row.item_id).run();
      updated += 1;
    }
    return Response.json({ updated });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to refresh institution branding." },
      { status: 500 },
    );
  }
}
