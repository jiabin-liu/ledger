import { getDb } from "../../../../db";
import { plaidItems } from "../../../../db/schema";
import { syncItem } from "../../../../lib/sync";

const AUTO_SYNC_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    // `auto=1` is used for the on-open background sync: skip any institution refreshed
    // within the last 24h so opening the app repeatedly doesn't hammer Plaid. The manual
    // "Sync" button (no query param) always force-syncs every institution immediately.
    const auto = new URL(request.url).searchParams.get("auto") === "1";
    const allItems = await getDb().select().from(plaidItems);
    // A "disconnected" item's access token has been revoked at Plaid (e.g. after an
    // institution reconnect); syncing it would only fail and, left unguarded, abort the
    // whole batch before other institutions get their turn.
    const items = allItems.filter((item) => item.status !== "disconnected");
    const itemsToSync = auto
      ? items.filter((item) => {
        const lastSynced = new Date(item.updatedAt).getTime();
        return !Number.isFinite(lastSynced) || Date.now() - lastSynced >= AUTO_SYNC_MIN_INTERVAL_MS;
      })
      : items;
    let added = 0;
    for (const item of itemsToSync) added += await syncItem(item);
    return Response.json({ added, institutions: items.length, synced: itemsToSync.length });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to sync transactions." },
      { status: 500 },
    );
  }
}
