/** Cloudflare Worker entry point for Ledger. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { authenticateAccessRequest, type AuthenticatedOwner } from "../lib/cloudflare-access";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_POLICY_AUD?: string;
  ACCESS_ALLOWED_EMAILS?: string;
  CF_VERSION_METADATA?: {
    id: string;
    tag?: string;
    timestamp?: string;
  };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

const OWNER_EMAIL_HEADER = "x-ledger-owner-email";
const OWNER_SUBJECT_HEADER = "x-ledger-owner-subject";

// Requests only reach this Worker after Cloudflare Access already enforced its
// Google-login policy at the edge for the protected hostname. We still verify
// the Access JWT signature/issuer/audience here as defense in depth (e.g.
// against a bare workers.dev route or forged headers), then replace any
// inbound `x-ledger-owner-*` headers with the values we just verified so
// downstream app code never trusts client-supplied identity headers directly.
function withOwnerHeaders(request: Request, owner: AuthenticatedOwner): Request {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(OWNER_EMAIL_HEADER, owner.email);
  if (owner.subject) {
    requestHeaders.set(OWNER_SUBJECT_HEADER, owner.subject);
  } else {
    requestHeaders.delete(OWNER_SUBJECT_HEADER);
  }
  return new Request(request, { headers: requestHeaders });
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const owner = await authenticateAccessRequest(request, env);
    if (!owner) {
      return new Response("Forbidden", { status: 403 });
    }
    const authenticatedRequest = withOwnerHeaders(request, owner);

    const url = new URL(authenticatedRequest.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(authenticatedRequest, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, authenticatedRequest.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(authenticatedRequest, env, ctx);
  },
};

export default worker;
