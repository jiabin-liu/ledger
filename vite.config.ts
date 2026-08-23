import vinext from "vinext";
import { defineConfig } from "vite";

// Local/dev placeholder only. Production deploy uses root `wrangler.toml`
// (`pnpm run deploy` → `wrangler deploy --config wrangler.toml`) so this
// binding is not what ships to Cloudflare.
const LOCAL_PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

// macOS Seatbelt blocks FSEvents; polling keeps HMR working in sandboxed previews.
const usePollingWatch = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [
    {
      binding: "DB",
      database_name: "bank-local",
      database_id: LOCAL_PLACEHOLDER_DATABASE_ID,
    },
  ],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: usePollingWatch
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
