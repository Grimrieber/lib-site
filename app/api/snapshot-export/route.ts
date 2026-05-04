import { NextResponse } from "next/server";
import { getGuildSnapshot, getRosterEnrichments } from "@/lib/raiderio";

/**
 * Returns the full guild snapshot + enriched roster as one JSON payload.
 * The hourly GitHub Action calls this endpoint, saves the response to
 * `data/snapshot.json` in the repo, and pushes. That file is then the
 * persistent fallback when a live RIO/BNet fetch fails or returns a
 * suspiciously-partial response.
 *
 * Auth: bearer CRON_SECRET. Same secret as /api/refresh.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const snapshot = await getGuildSnapshot();
    const enrichments = await getRosterEnrichments();
    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      snapshot,
      enrichedRoster: enrichments.enrichedRoster,
      recentAchievements: enrichments.recentAchievements,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "export failed", message: String(err) },
      { status: 500 },
    );
  }
}
