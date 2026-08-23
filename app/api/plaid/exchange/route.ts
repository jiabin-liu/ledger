import { env } from "cloudflare:workers";
import { encryptAccessToken, getInstitutionBrand, plaidRequest } from "../../../../lib/plaid";
import { syncItem } from "../../../../lib/sync";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as {
      publicToken?: string;
      institutionId?: string;
      institutionName?: string;
    };
    if (!payload.publicToken) return Response.json({ error: "Missing public token." }, { status: 400 });

    const exchange = await plaidRequest<{ access_token: string; item_id: string }>(
      "/item/public_token/exchange",
      { public_token: payload.publicToken },
    );
    const encryptedToken = await encryptAccessToken(exchange.access_token);
    const brand = payload.institutionId
      ? await getInstitutionBrand(payload.institutionId).catch(() => ({ logo: null, primaryColor: null }))
      : { logo: null, primaryColor: null };
    const timestamp = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO plaid_items (
        item_id, institution_id, institution_name, institution_logo, institution_primary_color,
        access_token_ciphertext, sync_cursor, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        institution_id = excluded.institution_id,
        institution_name = excluded.institution_name,
        institution_logo = excluded.institution_logo,
        institution_primary_color = excluded.institution_primary_color,
        access_token_ciphertext = excluded.access_token_ciphertext,
        status = 'active',
        updated_at = excluded.updated_at
    `).bind(
      exchange.item_id,
      payload.institutionId ?? null,
      payload.institutionName ?? "Connected institution",
      brand.logo,
      brand.primaryColor,
      encryptedToken,
      timestamp,
      timestamp,
    ).run();

    const added = await syncItem({
      itemId: exchange.item_id,
      accessTokenCiphertext: encryptedToken,
      syncCursor: null,
    });
    return Response.json({ connected: true, added });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save the institution." },
      { status: 500 },
    );
  }
}
