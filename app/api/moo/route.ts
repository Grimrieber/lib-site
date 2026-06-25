import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { buildMooPost, getNextCowUrl } from "@/lib/moo";
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
// Dedup keys of the last N posts, so buildMooPost won't repeat a caption — or
// the same M+ run phrased two ways — within that window. At twice-daily posting
// (15:00 / 23:00 UTC) this is ~N/2 days of no-repeat. Was 4 (only ~2 days), which
// let a caption — especially a line drawn from his small recent-runs pool, e.g.
// "+10 Skyreach" — come back after a couple days and read as a repeat. 24 ≈ 12
// days. The re-roll in buildMooPost escapes to the unbounded combinatorial
// generator when the smaller pools (activity/dynamic/static) are all in-window,
// so a large N never starves the picker. TTL'd so it self-cleans if posting stops.
const RECENT_KEYS_KEY = "lib:moo:recentkeys";
const RECENT_KEYS_MAX = 24;
const RECENT_KEYS_TTL = 14 * 24 * 60 * 60;
// Tripwire: the last N cow IMAGE urls actually posted. A second, independent
// layer over the playlist cursor — if the picker ever hands back an image we
// posted recently, we re-pick a fresh one (channel never sees the repeat) AND
// bump `lib:moo:dupalert` so we have hard, queryable proof. dupalert stays 0 =
// the rotation never repeated; non-zero = it caught itself. Renders (his
// portrait) are intentionally recurring, so they're NOT tracked here.
const RECENT_IMAGES_KEY = "lib:moo:recentimages";
const RECENT_IMAGES_MAX = 40;
const DUP_ALERT_KEY = "lib:moo:dupalert";

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
      // Already served this window? (read) — covers the catch-up pings that fire
      // between windows once a window's been posted.
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
      // ATOMIC double-post guard. NX = set-only-if-absent, so of any concurrent
      // pings exactly ONE claims the slot and posts; the rest skip. The old
      // GET-check-then-post-then-SET gate was check-then-act and RACED: GitHub's
      // cron fires at unpredictable minutes and can land on top of the local
      // task's :51 ping — both passed the GET before either wrote, so two cows
      // posted (same image, since both read the same playlist cursor, + a
      // near-identical caption). Released on a failed post below so a transient
      // Discord error can still retry this window.
      const claimed = await redis.set(LAST_POST_KEY, Date.now(), {
        nx: true,
        ex: COOLDOWN_SECONDS,
      });
      if (!claimed) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "anti-burst: a post just fired / is in progress",
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
  let imageUrl = post.imageUrl;

  // Image tripwire (cows only — renders are his intentionally-recurring portrait).
  // Second, independent layer over the rotation cursor: if the picker ever hands
  // back a recently-posted cow, record the alarm + re-pick a fresh one so the
  // channel NEVER shows the repeat. dupalert == 0 is the standing proof.
  let recentImages: string[] = [];
  if (redis && post.kind === "cow") {
    try {
      recentImages = (await redis.get<string[]>(RECENT_IMAGES_KEY)) ?? [];
    } catch {
      /* best-effort */
    }
    if (imageUrl && recentImages.includes(imageUrl)) {
      console.error(
        `[moo] DUP ALERT: rotation returned a recently-posted cow (${imageUrl}); re-picking`,
      );
      try {
        await redis.incr(DUP_ALERT_KEY);
      } catch {
        /* best-effort */
      }
      for (let i = 0; i < 5 && imageUrl && recentImages.includes(imageUrl); i++) {
        imageUrl = await getNextCowUrl(redis);
      }
    }
  }

  const body = {
    username: "Daily Moo",
    embeds: [
      {
        color: MOO_GREEN,
        title: "🐄 DAILY MOO",
        description: post.text,
        ...(imageUrl ? { image: { url: imageUrl } } : {}),
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
    if (res.ok && redis) {
      // The anti-burst lock (LAST_POST_KEY) was already armed atomically by the
      // NX claim above. Mark this window served so later pings (until the next
      // window) skip, and remember the caption for dedup.
      await redis.set(LAST_WINDOW_KEY, dueWindow.toISOString(), {
        ex: LAST_WINDOW_TTL,
      });
      const updated = [post.key, ...recentKeys.filter((k) => k !== post.key)].slice(
        0,
        RECENT_KEYS_MAX,
      );
      await redis.set(RECENT_KEYS_KEY, updated, { ex: RECENT_KEYS_TTL });
      // Record the cow image actually sent (the tripwire's verification log).
      if (post.kind === "cow" && imageUrl) {
        const imgs = [imageUrl, ...recentImages.filter((u) => u !== imageUrl)].slice(
          0,
          RECENT_IMAGES_MAX,
        );
        await redis.set(RECENT_IMAGES_KEY, imgs, { ex: RECENT_KEYS_TTL });
      }
    } else if (!res.ok && redis && !force) {
      // Post rejected — release the claim so the next ping can retry this window
      // (we never marked it served).
      await redis.del(LAST_POST_KEY);
    }
    return NextResponse.json({ ok: res.ok, status: res.status });
  } catch (err) {
    // Network/throw — release the claim so the window isn't locked out for 30m.
    if (redis && !force) await redis.del(LAST_POST_KEY);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 502 },
    );
  }
}
