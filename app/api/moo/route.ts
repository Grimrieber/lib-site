import { NextResponse } from "next/server";
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
// Hard anti-spam guard: after a successful post, refuse to post again for this
// long no matter how many times the route is hit (a double-firing cron, a
// retry, a stray test loop). The twice-daily schedule is ~12h apart, well
// outside this window, so both legit posts still go through. `?force=1`
// bypasses it for a deliberate one-off test.
const COOLDOWN_SECONDS = 6 * 60 * 60;
const LAST_POST_KEY = "lib:moo:lastpost";
// Dedup keys of the last few posts, so buildMooPost won't repeat a caption — or
// the same M+ run phrased two ways — across consecutive runs. Kept short and
// TTL'd so it self-cleans if posting ever stops.
const RECENT_KEYS_KEY = "lib:moo:recentkeys";
const RECENT_KEYS_MAX = 4;
const RECENT_KEYS_TTL = 14 * 24 * 60 * 60;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const force = new URL(req.url).searchParams.get("force") === "1";
  const webhook = process.env.DISCORD_WEBHOOK_MOO;
  const redis = getRedis();

  // Cooldown only matters when we'd actually post (webhook present). One post
  // per window, hard-stop — this is what makes a burst impossible.
  if (webhook && redis && !force) {
    const last = await redis.get(LAST_POST_KEY);
    if (last) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `within ${COOLDOWN_SECONDS / 3600}h cooldown — one post per window`,
      });
    }
  }

  // Avoid repeating recent captions/runs. Best-effort: no store → no history.
  let recentKeys: string[] = [];
  if (redis) {
    try {
      recentKeys = (await redis.get<string[]>(RECENT_KEYS_KEY)) ?? [];
    } catch {
      /* best-effort */
    }
  }

  const post = await buildMooPost(recentKeys);

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
