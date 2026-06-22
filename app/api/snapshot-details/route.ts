import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { generateCharacterDetailsIncremental } from "@/lib/raiderio";

/**
 * Precomputes character-sheet detail into Redis so the character page reads it
 * instead of live-fetching (kills the cold-gen "couldn't load" 500). The hourly
 * cron pings this every active run; it re-fetches ONLY characters RIO re-crawled
 * since last run, so the steady-state cost is a handful of characters.
 *
 * ?force=1 (or ?mode=seed) ignores the gate and regenerates the whole roster —
 * the one-time backfill. Auth: bearer CRON_SECRET (fail-closed in prod).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const force =
    url.searchParams.get("force") === "1" ||
    url.searchParams.get("mode") === "seed";

  try {
    const result = await generateCharacterDetailsIncremental({ force });
    return NextResponse.json({
      ok: true,
      force,
      ...result,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
