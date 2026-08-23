import { headers } from "next/headers";

/**
 * Reads the owner identity that `worker/index.ts` already verified against
 * Cloudflare Access before this request reached the Next.js app router. Do
 * not read `cf-access-*` headers directly anywhere else in the app; the
 * Worker entry point is the single place that talks to Cloudflare Access.
 */
export type LedgerOwner = {
  email: string;
  subject: string | null;
};

const OWNER_EMAIL_HEADER = "x-ledger-owner-email";
const OWNER_SUBJECT_HEADER = "x-ledger-owner-subject";

export async function getLedgerOwner(): Promise<LedgerOwner | null> {
  const requestHeaders = await headers();
  const email = requestHeaders.get(OWNER_EMAIL_HEADER);
  if (!email) return null;

  return {
    email,
    subject: requestHeaders.get(OWNER_SUBJECT_HEADER),
  };
}
