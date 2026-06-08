import { NextResponse, type NextRequest } from "next/server";
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

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.ANNOUNCE_SECRET ?? process.env.CRON_SECRET;
  if (!expected) return true; // dev convenience
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
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
  if (!isAuthorized(req))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

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

  const webhook = process.env.DISCORD_WEBHOOK_ANNOUNCE;
  if (!webhook)
    return NextResponse.json(
      { ok: false, error: "DISCORD_WEBHOOK_ANNOUNCE not set" },
      { status: 503 },
    );

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") === "seed" ? "seed" : "detect";
  const force = searchParams.get("force") === "1";

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
      await postMany(events, webhook);
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

  // --- detect (ongoing) ----------------------------------------------------
  if (!baseline.seeded)
    return NextResponse.json(
      { ok: false, error: "not seeded yet — run ?mode=seed first" },
      { status: 409 },
    );

  const { events, nextBaseline, notes } = detect(snapshot, baseline);

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
      await postMany(toPost, webhook);
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
