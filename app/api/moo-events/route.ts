import { NextResponse } from "next/server";
import {
  getBoobDeathStats,
  getBoobRecentAchievements,
  describeNewDeaths,
  describeAchievementSummary,
  loadEventBaseline,
  saveEventBaseline,
  newAchievements,
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
const SEEN_CAP = 200;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const seed = url.searchParams.get("mode") === "seed";
  const webhook = process.env.DISCORD_WEBHOOK_MOO;

  const [deaths, recent, baseline] = await Promise.all([
    getBoobDeathStats(),
    getBoobRecentAchievements(),
    loadEventBaseline(),
  ]);

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
  // New achievements → ONE summary post (not one each).
  const fresh = newAchievements(baseline.seenAchievementIds, recent);
  const achSummary = describeAchievementSummary(fresh.map((a) => a.name));
  if (achSummary) events.push({ color: GOLD, text: achSummary });

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
      ...new Set([...baseline.seenAchievementIds, ...recent.map((r) => r.id)]),
    ].slice(-SEEN_CAP),
  });

  return NextResponse.json({ ok: true, newEvents: events.length, posted });
}
