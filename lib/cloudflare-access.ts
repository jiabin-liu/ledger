import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/**
 * Verifies Cloudflare Access identity for requests to the owner-only Worker.
 *
 * Cloudflare Access sits in front of the protected hostname and only forwards
 * requests that already passed its Google-login policy. This module re-verifies
 * the `Cf-Access-Jwt-Assertion` signature/issuer/audience inside the Worker so a
 * request that reaches origin through any other path (e.g. a workers.dev route,
 * or a forged header) is still rejected. See `DEPLOYMENT.md` for Access + Google setup.
 */
export type AccessEnv = {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_POLICY_AUD?: string;
  ACCESS_ALLOWED_EMAILS?: string;
};

export type AuthenticatedOwner = {
  email: string;
  subject: string | null;
  claims: JWTPayload;
};

let cachedJwks: JWTVerifyGetKey | null = null;
let cachedTeamDomain: string | null = null;

function getJwks(teamDomain: string): JWTVerifyGetKey {
  if (!cachedJwks || cachedTeamDomain !== teamDomain) {
    cachedJwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    cachedTeamDomain = teamDomain;
  }
  return cachedJwks;
}

export async function authenticateAccessRequest(
  request: Request,
  env: AccessEnv,
): Promise<AuthenticatedOwner | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;

  const { ACCESS_TEAM_DOMAIN, ACCESS_POLICY_AUD, ACCESS_ALLOWED_EMAILS } = env;
  if (!ACCESS_TEAM_DOMAIN || !ACCESS_POLICY_AUD || !ACCESS_ALLOWED_EMAILS) {
    return null;
  }

  try {
    const jwks = getJwks(ACCESS_TEAM_DOMAIN);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: ACCESS_TEAM_DOMAIN,
      audience: ACCESS_POLICY_AUD,
    });

    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    const allowedEmails = new Set(
      ACCESS_ALLOWED_EMAILS.split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
    if (!email || !allowedEmails.has(email)) return null;

    return {
      email,
      subject: typeof payload.sub === "string" ? payload.sub : null,
      claims: payload,
    };
  } catch {
    return null;
  }
}
