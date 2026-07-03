import { NextResponse, type NextRequest } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import bundled from "@/data/snapshot.json";
import type { GuildSnapshot } from "@/lib/types";
import {
  type AnnounceEvent,
  postMany,
} from "@/lib/discord-announce";
import {
  baselineFromSnapshot,
  detect,
  seedEvents,
} from "@/lib/announce-detect";
import { overlayFreshScores, type OverlayResult } from "@/lib/announce-fresh";
import {
  clearBaseline,
  getRedis,
  loadBaseline,
  saveBaseline,
} from "@/lib/announce-store";

/**
 * Discord announcement endpoint.
 *
 * Two modes (query `?mode=`):
 *   - detect (default): diff the snapshot against the Upstash baseline and
 *     post new events (kills / record / PBs / Resilient). Every 10th post is
 *     a site-reminder. Intended to be called once per hourly refresh.
 *   - seed: one-time cold start. Posts a best-of-each set of current standings
 *     and writes the baseline so nothing pre-existing re-announces. Refuses to
 *     run twice unless `&force=1` (which also wipes the baseline first).
 *
 * Snapshot source: GET uses the committed bundled snapshot (this deployment's
 * data/snapshot.json). POST reads the snapshot from the request body — the
 * refresh workflow POSTs the freshly-built file so the announce doesn't have
 * to wait for Vercel to redeploy with the new data.
 *
 * Auth: Bearer ANNOUNCE_SECRET (falls back to CRON_SECRET). Unset → permitted
 * for local dev, same convention as /api/refresh. Lock it down in production.
 */

export const dynamic = "force-dynamic";

/** Site-reminder cadence: post the house ad after this many announcements. */
const REMINDER_EVERY = 10;

function authDenied(req: NextRequest): NextResponse | null {
  // Fail-closed in production (see lib/cron-auth.ts). Accepts ANNOUNCE_SECRET
  // or CRON_SECRET; unauthenticated only in local dev.
  return requireCronAuth(
    req,
    process.env.ANNOUNCE_SECRET ?? process.env.CRON_SECRET,
  );
}

/** Accept either the export-file wrapper ({ snapshot: … }) or a bare snapshot. */
function extractSnapshot(obj: unknown): GuildSnapshot | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const snap = (o.snapshot ?? o) as Record<string, unknown>;
  if (!snap || !Array.isArray(snap.roster) || !Array.isArray(snap.tiers))
    return null;
  return snap as unknown as GuildSnapshot;
}

async function run(
  req: NextRequest,
  snapshot: GuildSnapshot | null,
): Promise<NextResponse> {
  const denied = authDenied(req);
  if (denied) return denied;

  if (!snapshot)
    return NextResponse.json(
      { ok: false, error: "no valid snapshot (need .roster and .tiers)" },
      { status: 400 },
    );

  const redis = getRedis();
  if (!redis)
    return NextResponse.json(
      { ok: false, error: "Upstash not configured" },
      { status: 503 },
    );

  const { searchParams } = new URL(req.url);
  const modeParam = searchParams.get("mode");
  const mode =
    modeParam === "seed"
      ? "seed"
      : modeParam === "catchup"
        ? "catchup"
        : "detect";
  const force = searchParams.get("force") === "1";
  // Dry-run: detect + return the events WITHOUT posting or advancing the
  // baseline (and without needing a webhook) — for verifying detection.
  const dry = searchParams.get("dry") === "1";
  // Fresh-score overlay is ON by default for detect; `fresh=0` opts out.
  const useFresh = searchParams.get("fresh") !== "0";

  const webhook = process.env.DISCORD_WEBHOOK_ANNOUNCE;
  if (!webhook && !dry)
    return NextResponse.json(
      { ok: false, error: "DISCORD_WEBHOOK_ANNOUNCE not set" },
      { status: 503 },
    );

  const baseline = await loadBaseline(redis);

  // --- seed (one-time cold start) -----------------------------------------
  if (mode === "seed") {
    if (baseline.seeded && !force)
      return NextResponse.json(
        {
          ok: false,
          error: "already seeded — pass &force=1 to reseed (wipes baseline)",
        },
        { status: 409 },
      );
    if (force) await clearBaseline(redis);

    const content = seedEvents(snapshot);
    const events: AnnounceEvent[] = [...content, { kind: "reminder" }];
    try {
      await postMany(events, webhook!);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `post failed: ${(e as Error).message}` },
        { status: 502 },
      );
    }
    // Only mark seeded after the posts land.
    await saveBaseline(redis, baselineFromSnapshot(snapshot));
    return NextResponse.json({
      ok: true,
      mode: "seed",
      posted: events.length,
      events: content.map((e) => e.kind),
    });
  }

  // --- catchup (one-time) --------------------------------------------------
  // Posts the notable recent timed keys the old PB threshold (25) silently ate
  // (+19 and up, per the roster audit). One-time, run-based (real dungeon +
  // level, not a fabricated score delta), and does NOT touch the detect
  // baseline. A Redis flag makes it idempotent so it can't double-post; &force=1
  // re-posts (testing). Score + avatar are resolved live from the snapshot.
  if (mode === "catchup") {
    const DONE_KEY = "announce:catchup:v1";
    if ((await redis.get(DONE_KEY)) && !force)
      return NextResponse.json(
        { ok: false, error: "catch-up already posted (pass &force=1 to repeat)" },
        { status: 409 },
      );
    const CATCHUP: { player: string; dungeon: string; level: number }[] = [
      { player: "Totemtartt", dungeon: "Magisters' Terrace", level: 21 },
      { player: "Anorxxorcist", dungeon: "Skyreach", level: 20 },
      { player: "Kujatas", dungeon: "Pit of Saron", level: 20 },
      { player: "Sadewolf", dungeon: "Maisara Caverns", level: 19 },
      { player: "Anorexorcist", dungeon: "Pit of Saron", level: 19 },
      { player: "Churd", dungeon: "Maisara Caverns", level: 19 },
    ];
    const byName = new Map(
      snapshot.roster.map((c) => [c.name.toLowerCase(), c]),
    );
    const context = snapshot.tierExpansionName || undefined;
    const events: AnnounceEvent[] = CATCHUP.map((r) => {
      const c = byName.get(r.player.toLowerCase());
      return {
        kind: "pb",
        player: r.player,
        score: c?.mythicPlusScore ?? 0,
        dungeon: r.dungeon,
        level: r.level,
        avatar: c?.avatarUrl,
        context,
      };
    });
    try {
      await postMany(events, webhook!);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `post failed: ${(e as Error).message}` },
        { status: 502 },
      );
    }
    await redis.set(DONE_KEY, new Date().toISOString());
    return NextResponse.json({
      ok: true,
      mode: "catchup",
      posted: events.length,
      players: CATCHUP.map((r) => r.player),
    });
  }

  // --- detect (ongoing) ----------------------------------------------------
  if (!baseline.seeded)
    return NextResponse.json(
      { ok: false, error: "not seeded yet — run ?mode=seed first" },
      { status: 409 },
    );

  // Overlay CURRENT RIO scores (incremental — only members active in the last
  // 48h) so PB/record/Resilient detection runs on on-time scores, not the
  // snapshot's build-time values. This is what lets a key surface within ~1h
  // when the refresh re-POSTs the snapshot hourly.
  const overlay = useFresh ? await overlayFreshScores(snapshot) : null;

  const { events, nextBaseline, notes } = detect(snapshot, baseline);

  if (dry) {
    // Verify detection without posting or advancing the baseline.
    return NextResponse.json({
      ok: true,
      mode: "detect",
      dry: true,
      detected: events.length,
      events,
      overlay,
      notes,
    });
  }

  // Interleave the site-reminder by the running counter.
  let counter = baseline.counter;
  const toPost: AnnounceEvent[] = [];
  for (const ev of events) {
    toPost.push(ev);
    counter += 1;
    if (counter >= REMINDER_EVERY) {
      toPost.push({ kind: "reminder" });
      counter = 0;
    }
  }
  nextBaseline.counter = counter;

  if (toPost.length > 0) {
    try {
      await postMany(toPost, webhook!);
    } catch (e) {
      // Don't advance the baseline — let the unposted deltas retry next run.
      return NextResponse.json(
        { ok: false, error: `post failed: ${(e as Error).message}` },
        { status: 502 },
      );
    }
  }
  await saveBaseline(redis, nextBaseline);

  const reminders = toPost.length - events.length;
  return NextResponse.json({
    ok: true,
    mode: "detect",
    detected: events.length,
    posted: toPost.length,
    reminders,
    overlay: overlay
      ? { candidates: overlay.candidates, changed: overlay.changed.length }
      : null,
    notes,
  });
}

export async function GET(req: NextRequest) {
  return run(req, extractSnapshot(bundled));
}

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // fall back to the bundled snapshot if no/invalid body was sent
  }
  return run(req, extractSnapshot(body) ?? extractSnapshot(bundled));
}
