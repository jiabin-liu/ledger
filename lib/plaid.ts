import { env } from "cloudflare:workers";

type PlaidEnvironment = "sandbox" | "production";

function config() {
  const environment = (env.PLAID_ENV ?? process.env.PLAID_ENV ?? "sandbox") as PlaidEnvironment;
  const clientId = env.PLAID_CLIENT_ID ?? process.env.PLAID_CLIENT_ID;
  const secret = env.PLAID_SECRET ?? process.env.PLAID_SECRET;

  if (!clientId || !secret) throw new Error("Plaid credentials are not configured.");
  if (!['sandbox', 'production'].includes(environment)) throw new Error("PLAID_ENV must be sandbox or production.");

  return { environment, clientId, secret };
}

export function plaidEnvironment() {
  return config().environment;
}

export async function plaidRequest<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const { environment, clientId, secret } = config();
  const response = await fetch(`https://${environment}.plaid.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, secret, ...payload }),
  });
  const body = (await response.json()) as T & { error_message?: string; display_message?: string };
  if (!response.ok) throw new Error(body.display_message ?? body.error_message ?? "Plaid request failed.");
  return body;
}

export async function getInstitutionBrand(institutionId: string) {
  const response = await plaidRequest<{
    institution: { logo?: string | null; primary_color?: string | null };
  }>("/institutions/get_by_id", {
    institution_id: institutionId,
    country_codes: ["US"],
    options: { include_optional_metadata: true },
  });
  return {
    logo: response.institution.logo ? `data:image/png;base64,${response.institution.logo}` : null,
    primaryColor: response.institution.primary_color ?? null,
  };
}

async function encryptionKey() {
  const { secret } = config();
  const material = new TextEncoder().encode(`ledger-plaid-token:v1:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptAccessToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(token),
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptAccessToken(value: string) {
  const combined = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: combined.slice(0, 12) },
    await encryptionKey(),
    combined.slice(12),
  );
  return new TextDecoder().decode(plaintext);
}
