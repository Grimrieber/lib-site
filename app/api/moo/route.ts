import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { buildMooPost } from "@/lib/moo";
import { getRedis } from "@/lib/announce-store";

/**
 * Posts one daily moo to the #only-moo Discord channel. The twice-a-day job
 * hits this; it builds a self-managing post (live render + live stats + curated
 * cows/captions, see lib/moo.ts) and sends it to the channel webhook.
 *
 * Fully hands-off: no body, no params. If DISCORD_WEBHOOK_MOO isn't configured
 * it doesn't post — it returns the post it WOULD have sent, so you can hit this
 * to preview the real output before wiring the webhook.
 *
 * Auth: bearer CRON_SECRET (same as the other cron routes). Unauthenticated is
 * allowed only when CRON_SECRET is unset (local dev).
 */
export const dynamic = "force-dynamic";

const MOO_GREEN = 0x6aa84f;
// Daily post windows (UTC hours). The route — not the cron runners — decides
// whether a window is due, so a runner that wakes LATE (GitHub delaying its
// :17 schedule, or the local PC booting after the hour) still posts the cow it
// missed instead of silently losing it. ~10am / 6pm Central in summer.
const POST_HOURS_UTC = [15, 23];
// The authoritative per-window dedup: the ISO start of the last window we
// served. We post only when the current due window is newer than this, then
// stamp it — so each window posts exactly once, and a missed window is caught
// up by the next ping (until the following window supersedes it). Long TTL so
// it self-cleans if posting is ever abandoned.
const LAST_WINDOW_KEY = "lib:moo:lastwindow";
const LAST_WINDOW_TTL = 7 * 24 * 60 * 60;
// Short anti-burst guard: after a successful post, refuse to post again for a
// few minutes no matter how many times the route is hit (two runners firing
// within seconds, a retry, a stray loop). The window marker above is what
// enforces one-per-window; this only absorbs sub-window races, so it's kept far
// shorter than the ~8h gap between windows and never blocks a legit window.
// `?force=1` bypasses both guards for a deliberate one-off test.
const COOLDOWN_SECONDS = 30 * 60;
const LAST_POST_KEY = "lib:moo:lastpost";
// When Upstash is unreachable we have no served-state to dedup against, so we
// can't ping every hour safely. Degrade to a narrow time gate: only post within
// this many minutes of a window boundary. Bounds an outage to ~1 post/window
// instead of an hourly spam loop.
const FALLBACK_GRACE_MIN = 90;
// Dedup keys of the last few posts, so buildMooPost won't repeat a caption — or
// the same M+ run phrased two ways — across consecutive runs. Kept short and
// TTL'd so it self-cleans if posting ever stops.
const RECENT_KEYS_KEY = "lib:moo:recentkeys";
const RECENT_KEYS_MAX = 4;
const RECENT_KEYS_TTL = 14 * 24 * 60 * 60;

// The most recent window boundary at or before `now`. If we're before the
// earliest window of the day, that's the last window of the previous day.
function mostRecentWindowStart(now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const h = now.getUTCHours();
  const desc = [...POST_HOURS_UTC].sort((a, b) => b - a);
  for (const wh of desc) {
    if (h >= wh) return new Date(Date.UTC(y, m, d, wh));
  }
  // Before today's first window → the latest window was yesterday's last one.
  return new Date(Date.UTC(y, m, d, desc[0]) - 24 * 60 * 60 * 1000);
}

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const force = new URL(req.url).searchParams.get("force") === "1";
  const webhook = process.env.DISCORD_WEBHOOK_MOO;
  const redis = getRedis();

  // Which window are we serving? Computed from the clock so a late ping still
  // maps to the window it belongs to.
  const dueWindow = mostRecentWindowStart(new Date());

  // Scheduling gate — skipped on force, and irrelevant on preview (no webhook,
  // handled below). With a store: post only if this window hasn't been served
  // yet (catch-up), guarded by a short anti-burst cooldown. Without a store:
  // fall back to a narrow time gate so an outage can't spam.
  if (webhook && !force) {
    if (redis) {
      const last = await redis.get(LAST_POST_KEY);
      if (last) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: `within ${COOLDOWN_SECONDS / 60}m anti-burst window`,
        });
      }
      let lastWindow: string | null = null;
      try {
        lastWindow = await redis.get<string>(LAST_WINDOW_KEY);
      } catch {
        /* best-effort — treat as unserved */
      }
      if (lastWindow && new Date(lastWindow).getTime() >= dueWindow.getTime()) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: `window ${dueWindow.toISOString()} already served`,
        });
      }
    } else {
      const minsSince = (Date.now() - dueWindow.getTime()) / 60000;
      if (minsSince > FALLBACK_GRACE_MIN) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: `no store; ${Math.round(minsSince)}m past window (> ${FALLBACK_GRACE_MIN}m grace)`,
        });
      }
    }
  }

  // Avoid repeating recent captions/runs. Best-effort: no store → no history.
  // (The cow IMAGE is deduped separately by the rotation in buildMooPost.)
  let recentKeys: string[] = [];
  if (redis) {
    try {
      recentKeys = (await redis.get<string[]>(RECENT_KEYS_KEY)) ?? [];
    } catch {
      /* best-effort */
    }
  }

  const post = await buildMooPost(recentKeys, redis);

  const body = {
    username: "Daily Moo",
    embeds: [
      {
        color: MOO_GREEN,
        title: "🐄 DAILY MOO",
        description: post.text,
        ...(post.imageUrl ? { image: { url: post.imageUrl } } : {}),
      },
    ],
    // Only user mentions ping (never @everyone/@here), and only when the
    // caption actually contains a <@id> (i.e. an id is configured).
    allowed_mentions: { parse: ["users"] as const },
  };

  if (!webhook) {
    return NextResponse.json({
      ok: false,
      reason: "DISCORD_WEBHOOK_MOO not set — preview only",
      wouldPost: body,
    });
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // Arm the cooldown only on a successful post. Key auto-expires after the
    // window, so its mere presence means "posted recently — don't post again."
    if (res.ok && redis) {
      await redis.set(LAST_POST_KEY, Date.now(), { ex: COOLDOWN_SECONDS });
      // Mark this window served so later pings (until the next window) skip.
      await redis.set(LAST_WINDOW_KEY, dueWindow.toISOString(), {
        ex: LAST_WINDOW_TTL,
      });
      // Prepend this post's key and keep only the most recent few.
      const updated = [post.key, ...recentKeys.filter((k) => k !== post.key)].slice(
        0,
        RECENT_KEYS_MAX,
      );
      await redis.set(RECENT_KEYS_KEY, updated, { ex: RECENT_KEYS_TTL });
    }
    return NextResponse.json({ ok: res.ok, status: res.status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 502 },
    );
  }
}
