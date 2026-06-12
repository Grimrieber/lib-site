import { NextResponse, type NextRequest } from "next/server";
import { getGuildSnapshotLive } from "@/lib/raiderio";

/**
 * Lightweight snapshot endpoint (local dev convenience).
 *
 * Resolves the guild snapshot and reports its size. It does NOT run the
 * BNet enrichments fanout or the per-character achievements warmup.
 *
 * History: this route used to also call getRosterEnrichmentsLive() (the
 * ~107s achievements whale) and warmupCharacterDetails() (re-fetch every
 * char's 2.67MB achievements blob) to prime an in-memory module cache.
 * The hourly cron's "warm cache" step hit it every hour, burning ~37s of
 * Active CPU per run (~5 of every 7 minutes of the site's total CPU) —
 * and since character pages became ISR-cached, they regenerate in their
 * own invocations and never read that module cache, so the warmup was
 * pure waste. The heavy work was removed; the production snapshot is
 * built by /api/snapshot-export + /api/snapshot-enrichments.
 *
 * Intended use now:
 *  - Local: curl localhost:3000/api/refresh after `npm run dev` to confirm
 *    the snapshot resolves (no auth required when REFRESH_SECRET is unset).
 *
 * Auth: in production, requires either Vercel's CRON_SECRET (auto-injected)
 * or a manually-set REFRESH_SECRET.
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
  const snap = await getGuildSnapshotLive();
  const tSnap = Date.now() - t0;

  return NextResponse.json({
    ok: true,
    rosterSize: snap.roster.length,
    timings: {
      snapshotMs: tSnap,
      totalMs: Date.now() - t0,
    },
  });
}
