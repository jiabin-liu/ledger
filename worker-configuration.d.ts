interface D1Result<T = unknown> {
  success: boolean;
  results?: T[];
  meta: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    PLAID_CLIENT_ID?: string;
    PLAID_SECRET?: string;
    PLAID_ENV?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_POLICY_AUD?: string;
    ACCESS_ALLOWED_EMAILS?: string;
    CF_VERSION_METADATA?: {
      id: string;
      tag?: string;
      timestamp?: string;
    };
  }
}

declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
}
