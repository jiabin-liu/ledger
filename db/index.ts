import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Ensure `wrangler.toml` binds `DB` to your D1 database (see DEPLOYMENT.md) or that local Vite/Miniflare injects the `DB` binding before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}
