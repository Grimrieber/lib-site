import { NextResponse, type NextRequest } from "next/server";
import {
  getCurrentTierKills,
  getGuildSnapshot,
  getRaidHistory,
  getRosterEnrichments,
  warmupCharacterDetails,
} from "@/lib/raiderio";

/**
 * Refresh + warmup endpoint.
 *
 * Resolves the snapshot + the auxiliary feeds (enrichments, raid history,
 * current-tier kills) and pre-fetches every roster character's detail into
 * the module cache. Subsequent visits to any cached page or character page
 * skip the BNet/RIO fanout and serve from memory.
 *
 * Intended uses:
 *  - Local: curl localhost:3000/api/refresh once after `npm run dev` so
 *    dev iterations on character pages are fast (no auth required when
 *    REFRESH_SECRET is unset).
 *  - Production: wired to a Vercel cron (every 30 min) — Vercel sends an
 *    `Authorization: Bearer <CRON_SECRET>` header automatically.
 *
 * Auth: in production, the endpoint requires either Vercel's CRON_SECRET
 * (auto-injected) or a manually-set REFRESH_SECRET. Without auth, anyone
 * could hammer the endpoint to drain BNet rate limits.
 */
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET ?? process.env.REFRESH_SECRET;
  // No secret configured → permit (dev convenience). Set REFRESH_SECRET
  // in production to lock the endpoint down.
  if (!expected) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const t0 = Date.now();
  const snap = await getGuildSnapshot();
  const tSnap = Date.now() - t0;

  const t1 = Date.now();
  const [enrichments, raidHistory, kills] = await Promise.all([
    getRosterEnrichments().catch(() => null),
    getRaidHistory().catch(() => []),
    getCurrentTierKills().catch(() => ({})),
  ]);
  const tFeeds = Date.now() - t1;

  const t2 = Date.now();
  await warmupCharacterDetails().catch(() => undefined);
  const tWarmup = Date.now() - t2;

  return NextResponse.json({
    ok: true,
    rosterSize: snap.roster.length,
    timings: {
      snapshotMs: tSnap,
      auxFeedsMs: tFeeds,
      characterWarmupMs: tWarmup,
      totalMs: Date.now() - t0,
    },
    enrichments: enrichments ? Object.keys(enrichments).length : 0,
    raidHistoryCount: raidHistory.length,
    killsCount: Object.keys(kills).length,
  });
}
