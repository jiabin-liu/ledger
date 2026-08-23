import { env } from "cloudflare:workers";

export type DeployVersion = {
  id: string;
  tag: string | null;
  timestamp: string | null;
};

/** Runtime Worker version from Cloudflare `version_metadata` binding (matches wrangler deploy Version ID). */
export function getDeployVersion(): DeployVersion | null {
  const meta = env.CF_VERSION_METADATA;
  if (!meta?.id) return null;
  return {
    id: meta.id,
    tag: meta.tag ?? null,
    timestamp: meta.timestamp ?? null,
  };
}
