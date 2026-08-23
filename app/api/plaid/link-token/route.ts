import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { getLedgerOwner } from "../../../access-auth";
import { decryptAccessToken, plaidEnvironment, plaidRequest } from "../../../../lib/plaid";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as { itemId?: string };
    const requestHeaders = await headers();
    const host = requestHeaders.get("host") ?? "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const owner = await getLedgerOwner();
    const userId = owner?.subject ?? owner?.email ?? "local-owner";

    let updateAccessToken: string | null = null;
    if (payload.itemId) {
      const item = await env.DB.prepare(
        "SELECT access_token_ciphertext FROM plaid_items WHERE item_id = ?",
      ).bind(payload.itemId).first<{ access_token_ciphertext: string }>();
      if (!item) return Response.json({ error: "Institution not found." }, { status: 404 });
      updateAccessToken = await decryptAccessToken(item.access_token_ciphertext);
    }

    const response = await plaidRequest<{ link_token: string }>("/link/token/create", {
      user: { client_user_id: userId },
      client_name: "Ledger",
      country_codes: ["US"],
      language: "en",
      ...(plaidEnvironment() === "production" ? { redirect_uri: `${protocol}://${host}/` } : {}),
      ...(updateAccessToken
        ? { access_token: updateAccessToken }
        : { products: ["transactions"], transactions: { days_requested: 730 } }),
    });
    return Response.json({ linkToken: response.link_token });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to start Plaid Link." },
      { status: 500 },
    );
  }
}
