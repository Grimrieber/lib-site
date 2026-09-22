import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import {
  readRuntimeSnapshot,
  snapshotStampMs,
  writeRuntimeSnapshot,
  type SnapshotFile,
} from "@/lib/snapshot-store";

/**
 * Publish a composed snapshot for running deployments to read.
 *
 * This is the step that decouples DATA freshness from DEPLOYMENTS. The cron
 * still commits `data/snapshot.json` (it stays the durable record, the seed for
 * the next build, and the thing git history is kept for), but the running
 * site no longer needs a rebuild to see it — it reads what this route stores.
 *
 * Before this existed, every refresh rebuilt all 35 functions to ship a 0.5 MB
 * JSON file: 227 of 249 deployments in a 30-day window, ~162 MB of function
 * bundle each, which is what kept exhausting the 10 GB Function Storage tier.
 *
 * Body: the composed file, exactly as `data/snapshot.json` is written —
 * `{ snapshot, enrichedRoster, recentAchievements, ... }`.
 *
 * Auth: bearer CRON_SECRET, same as the other snapshot routes.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  let file: SnapshotFile;
  try {
    file = (await req.json()) as SnapshotFile;
  } catch {
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 });
  }

  // Refuse anything that would be a downgrade. A half-written or truncated
  // payload must never replace a good published copy — every page render reads
  // this, so a bad publish is a site-wide outage, not a stale number.
  const roster = file?.snapshot?.roster;
  if (!Array.isArray(roster) || roster.length === 0) {
    return NextResponse.json(
      { error: "payload has no roster; refusing to publish" },
      { status: 400 },
    );
  }

  const incoming = snapshotStampMs(file);
  // Fresh read: this route is force-dynamic, and comparing against a cached
  // copy would defeat both guards below.
  const existing = await readRuntimeSnapshot({ fresh: true });
  if (existing) {
    const current = snapshotStampMs(existing);
    if (Number.isFinite(current) && Number.isFinite(incoming) && incoming < current) {
      return NextResponse.json(
        {
          skipped: "older than the published snapshot",
          publishedAt: new Date(current).toISOString(),
          incomingAt: new Date(incoming).toISOString(),
        },
        { status: 409 },
      );
    }
    // A big roster drop is the signature of a partial upstream response, which
    // is exactly what the cron's own regression guard watches for. Mirror it
    // here so a publish can't do what a commit would have been blocked from.
    const drop = existing.snapshot.roster.length - roster.length;
    if (drop > 0 && drop / existing.snapshot.roster.length > 0.25) {
      return NextResponse.json(
        {
          skipped: "roster regression >25%; refusing to publish",
          publishedRoster: existing.snapshot.roster.length,
          incomingRoster: roster.length,
        },
        { status: 409 },
      );
    }
  }

  const ok = await writeRuntimeSnapshot(file);
  if (!ok) {
    return NextResponse.json(
      { error: "redis unavailable; snapshot not published" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    published: true,
    rosterSize: roster.length,
    stampedAt: Number.isFinite(incoming)
      ? new Date(incoming).toISOString()
      : null,
  });
}
