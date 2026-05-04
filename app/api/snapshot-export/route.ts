import { NextResponse } from "next/server";
import {
  getGuildSnapshot,
  getRosterEnrichments,
  invalidateSnapshotCache,
} from "@/lib/raiderio";
import type { Character, GuildSnapshot } from "@/lib/types";

/**
 * Returns the full guild snapshot + enriched roster as one JSON payload.
 * Hourly GitHub Action calls this, saves to data/snapshot.json, pushes.
 *
 * Query params:
 *   ?merge=N  — clear snapshot cache, refetch up to N times with delays,
 *               and union the rosters (default 1, max 5). Each fresh
 *               fetch sees a different RIO bulk response, so the merged
 *               output catches characters that any one response would
 *               drop. Used by the cron to build a more complete fallback.
 *
 * Auth: bearer CRON_SECRET. Same secret as /api/refresh.
 */
export const dynamic = "force-dynamic";

const MERGE_DELAY_MS = 5_000;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const mergeRaw = parseInt(url.searchParams.get("merge") ?? "1", 10);
  const mergeCount = Math.min(
    5,
    Math.max(1, Number.isFinite(mergeRaw) ? mergeRaw : 1),
  );

  try {
    let snapshot: GuildSnapshot | null = null;
    let largestRoster = 0;

    for (let i = 0; i < mergeCount; i++) {
      if (i > 0) {
        invalidateSnapshotCache();
        await new Promise((r) => setTimeout(r, MERGE_DELAY_MS));
      }
      const fresh = await getGuildSnapshot();
      if (!snapshot) {
        snapshot = fresh;
      } else {
        snapshot = mergeRosters(snapshot, fresh);
      }
      if (snapshot.roster.length > largestRoster) {
        largestRoster = snapshot.roster.length;
      }
    }

    if (!snapshot) {
      return NextResponse.json(
        { error: "no snapshot built" },
        { status: 500 },
      );
    }

    const enrichments = await getRosterEnrichments();
    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      mergeCount,
      rosterSize: snapshot.roster.length,
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

/** Combine two snapshots by union of roster names. Uses the second
 *  snapshot's tier/rankings/runs (most recent point-in-time data), but
 *  keeps the larger roster — any character present in either snapshot
 *  appears in the result. When a character appears in both, the entry
 *  with the higher M+ score wins (proxy for "freshest"). */
function mergeRosters(a: GuildSnapshot, b: GuildSnapshot): GuildSnapshot {
  const byNameLc = new Map<string, Character>();
  for (const c of a.roster) {
    byNameLc.set(c.name.toLowerCase(), c);
  }
  for (const c of b.roster) {
    const existing = byNameLc.get(c.name.toLowerCase());
    if (!existing) {
      byNameLc.set(c.name.toLowerCase(), c);
      continue;
    }
    const existingScore = existing.mythicPlusScore ?? 0;
    const incomingScore = c.mythicPlusScore ?? 0;
    if (incomingScore >= existingScore) {
      byNameLc.set(c.name.toLowerCase(), c);
    }
  }
  return {
    ...b,
    roster: [...byNameLc.values()],
  };
}
