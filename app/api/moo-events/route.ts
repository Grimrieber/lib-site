import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { getRedis } from "@/lib/announce-store";
import {
  getBoobDeathStats,
  getBoobAchievementHistory,
  describeNewDeaths,
  describeNewResurrections,
  achievementSummaryPosts,
  achievementCutoff,
  missedAchievements,
  loadEventBaseline,
  saveEventBaseline,
  baselineToDeathStats,
  buildKickoffPost,
} from "@/lib/moo-events";

/**
 * Incremental event poster for #only-moo: posts the moment we detect a NEW
 * achievement or death for ZamboniBoob (MeatSupreme) — separate from the
 * twice-daily cow post (/api/moo). Meant to run every cycle (hourly); the
 * baseline diff means it posts only genuinely-new events, so frequent polling
 * never spams. Deaths batch into one report per poll ("died 3×…").
 *
 * Auth: bearer CRON_SECRET. First run (or ?mode=seed) just records the current
 * state and posts nothing. Without DISCORD_WEBHOOK_MOO it returns the posts it
 * WOULD send (dry-run preview). Not real-time — fires on the next poll after
 * Blizzard re-crawls his armory.
 */
export const dynamic = "force-dynamic";

const RED = 0xe23b3b;
const GOLD = 0xf0b232;
const MOO_GREEN = 0x6aa84f;
const REZ_GREEN = 0x43b581;
const SEEN_CAP = 200;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const seed = url.searchParams.get("mode") === "seed";
  const webhook = process.env.DISCORD_WEBHOOK_MOO;

  // Atomic double-post guard (same race as /api/moo): GitHub's cron can land on
  // top of the local task's ping, and both would read the same baseline before
  // either advances it -> the same new achievements/deaths posted twice. NX lock
  // = only one concurrent run proceeds; the other skips. 5-min TTL just covers
  // the coincidence window (real polls are ~2h apart). Seed bypasses it.
  const lockRedis = getRedis();
  if (webhook && !seed && lockRedis) {
    const claimed = await lockRedis.set("lib:moo:events:lock", Date.now(), {
      nx: true,
      ex: 300,
    });
    if (!claimed) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "another moo-events run in progress",
      });
    }
  }

  const [deaths, history, baseline] = await Promise.all([
    getBoobDeathStats(),
    getBoobAchievementHistory(),
    loadEventBaseline(),
  ]);
  const nowMs = Date.now();
  // Newest-first slice for the one-time kickoff post, derived from the full
  // history (the detection path below uses the whole history, not this slice).
  const recent = [...history]
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, 10);

  // Seed (first run / ?mode=seed): post the ONE-TIME kickoff (his last 5
  // achievements + death tally), record current state, then go incremental.
  // This is the intro post; it does NOT replay his whole history.
  if (!baseline || seed) {
    const kickoff = buildKickoffPost(deaths, recent);
    let posted = false;
    if (webhook) {
      try {
        const r = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "Daily Moo",
            embeds: [
              {
                color: MOO_GREEN,
                title: kickoff.title,
                description: kickoff.description,
              },
            ],
            allowed_mentions: { parse: ["users"] as const },
          }),
        });
        posted = r.ok;
      } catch {
        /* non-fatal; baseline still seeds below */
      }
    }
    if (deaths) {
      await saveEventBaseline({
        deathTotal: deaths.total,
        deathByName: deaths.byName,
        seenAchievementIds: recent.map((r) => r.id),
        // Seed at the newest achievement so detection only posts ones earned
        // AFTER seeding — the kickoff already showed the recent batch.
        lastAchievementTs: history.length
          ? Math.max(...history.map((a) => a.completedAt))
          : undefined,
      });
    }
    return NextResponse.json({
      seeded: true,
      kickoff: webhook ? (posted ? "posted" : "post-failed") : kickoff,
    });
  }

  // Diff vs baseline → only NEW events.
  const events: { color: number; text: string }[] = [];
  const deathText = deaths
    ? describeNewDeaths(baselineToDeathStats(baseline), deaths)
    : null;
  if (deathText) events.push({ color: RED, text: deathText });
  // Resurrection report — the counterpart to deaths.
  const rezText = deaths
    ? describeNewResurrections(baselineToDeathStats(baseline), deaths)
    : null;
  if (rezText) events.push({ color: REZ_GREEN, text: rezText });
  // New achievements since the cutoff — UNCAPPED (full history, not the 10-entry
  // recent window), oldest first, split into <=20-per-embed summary posts so a
  // long catch-up (e.g. the freeze backlog) all gets through.
  const cutoff = achievementCutoff(baseline, history, nowMs);
  const missed = missedAchievements(history, baseline.seenAchievementIds, cutoff);
  for (const text of achievementSummaryPosts(missed.map((a) => a.name))) {
    events.push({ color: GOLD, text });
  }

  if (!webhook) {
    return NextResponse.json({
      ok: false,
      reason: "DISCORD_WEBHOOK_MOO not set — dry-run preview",
      wouldPost: events.map((e) => e.text),
    });
  }

  let posted = 0;
  for (const e of events) {
    const body = {
      username: "Daily Moo",
      embeds: [{ color: e.color, description: e.text }],
      allowed_mentions: { parse: ["users"] as const },
    };
    try {
      const r = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) posted++;
    } catch {
      /* skip; baseline still advances below to avoid re-spamming on retry */
    }
  }

  // Advance the baseline regardless of individual post failures (a failed post
  // is preferable to spamming it every hour). Keep death stats if BNet flaked.
  await saveEventBaseline({
    deathTotal: deaths ? deaths.total : baseline.deathTotal,
    deathByName: deaths ? deaths.byName : baseline.deathByName,
    seenAchievementIds: [
      ...new Set([...baseline.seenAchievementIds, ...missed.map((a) => a.id)]),
    ].slice(-SEEN_CAP),
    // Advance the cutoff to the newest we just posted so we never re-scan/re-post
    // the backlog; idle polls keep it unchanged.
    lastAchievementTs: missed.length
      ? Math.max(cutoff, ...missed.map((a) => a.completedAt))
      : baseline.lastAchievementTs ?? cutoff,
  });

  return NextResponse.json({ ok: true, newEvents: events.length, posted });
}
