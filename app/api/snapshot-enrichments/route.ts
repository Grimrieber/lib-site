import { NextResponse } from "next/server";
import { getRosterEnrichmentsLive } from "@/lib/raiderio";

/**
 * Returns just the BNet-derived roster enrichments — tier badges per
 * character + the recent guild achievements feed. The hourly GitHub
 * Action calls this in parallel with /api/snapshot-export?lite=1 and
 * merges the two payloads into data/snapshot.json.
 *
 * Why a separate endpoint:
 *   The combined snapshot+enrichments call frequently exceeded Vercel
 *   Hobby's 60s function-timeout cap during peak load (:00-of-hour
 *   GitHub-wide cron rush). Splitting the work means each function
 *   invocation only does one slow thing and stays well under 60s.
 *
 * Auth: bearer CRON_SECRET. Same secret as /api/refresh and
 * /api/snapshot-export.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const enrichments = await getRosterEnrichmentsLive();
    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      enrichedRoster: enrichments.enrichedRoster,
      recentAchievements: enrichments.recentAchievements,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "enrichments fetch failed", message: String(err) },
      { status: 500 },
    );
  }
}
