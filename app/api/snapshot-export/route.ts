import { NextResponse } from "next/server";
import {
  getGuildSnapshotLive,
  getRosterEnrichmentsLive,
  invalidateSnapshotCache,
} from "@/lib/raiderio";
import type { Character, GuildSnapshot } from "@/lib/types";

/**
 * Returns the guild snapshot, optionally with enriched roster, as a JSON
 * payload. The hourly GitHub Action calls this, saves it, and (combined
 * with the enrichments endpoint) pushes a fresh data/snapshot.json.
 *
 * Query params:
 *   ?merge=N  — clear snapshot cache, refetch up to N times with delays,
 *               and union the rosters (default 1, max 5). Each fresh
 *               fetch sees a different RIO bulk response, so the merged
 *               output catches characters any one response would drop.
 *   ?lite=1   — skip the BNet enrichments fanout. Returns just the
 *               snapshot, no enrichedRoster / recentAchievements. Fast
 *               enough to fit comfortably under Vercel Hobby's 60s
 *               function-timeout cap even at peak. The cron uses this
 *               and pulls enrichments separately from
 *               /api/snapshot-enrichments.
 *
 * Auth: bearer CRON_SECRET. Same secret as /api/refresh.
 */
export const dynamic = "force-dynamic";

const MERGE_DELAY_MS = 5_000;

export async function GET(req: Request) {
  // No CRON_SECRET set (local dev) → allow unauthenticated, matching how
  // /api/refresh treats its REFRESH_SECRET. In production CRON_SECRET is
  // always set, so this stays locked down to Vercel's cron header.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const url = new URL(req.url);
  const mergeRaw = parseInt(url.searchParams.get("merge") ?? "1", 10);
  const mergeCount = Math.min(
    5,
    Math.max(1, Number.isFinite(mergeRaw) ? mergeRaw : 1),
  );
  const lite = url.searchParams.get("lite") === "1";

  try {
    let snapshot: GuildSnapshot | null = null;
    let largestRoster = 0;

    for (let i = 0; i < mergeCount; i++) {
      if (i > 0) {
        invalidateSnapshotCache();
        await new Promise((r) => setTimeout(r, MERGE_DELAY_MS));
      }
      const fresh = await getGuildSnapshotLive();
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

    const body: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      mergeCount,
      rosterSize: snapshot.roster.length,
      snapshot,
    };
    if (!lite) {
      const enrichments = await getRosterEnrichmentsLive();
      body.enrichedRoster = enrichments.enrichedRoster;
      body.recentAchievements = enrichments.recentAchievements;
    }
    return NextResponse.json(body);
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
