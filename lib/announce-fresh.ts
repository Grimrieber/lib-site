/**
 * Fresh-score overlay for the announcement feed.
 *
 * The snapshot's `mythicPlusScore` is RIO's value AT SNAPSHOT-BUILD TIME. RIO
 * re-crawls a character minutes-to-hours after they finish a key, so a run timed
 * shortly BEFORE (or after) a build isn't reflected until RIO catches up — which
 * means the feed, reading only the build-time score, misses the PB until the
 * next build ~2h later (this is exactly why Kujatas' +31 didn't post on time).
 *
 * `overlayFreshScores` re-queries each roster member's CURRENT season M+ score
 * directly from RIO at announce time and writes it onto the snapshot roster in
 * place, so PB/record/Resilient detection runs against on-time scores. Combined
 * with running the announce hourly (not just on the 2h snapshot build), a new
 * key surfaces within ~1h instead of being silently dropped. Per-member failure
 * (timeout, mojibake name, 404) keeps the existing snapshot value — never worse.
 */

import type { GuildSnapshot } from "@/lib/types";

const REGION = process.env.RIO_REGION ?? "us";
const FETCH_TIMEOUT_MS = 8000;

async function fetchCurrentScore(
  realmSlug: string,
  name: string,
): Promise<number | null> {
  const url =
    `https://raider.io/api/v1/characters/profile?region=${REGION}` +
    `&realm=${encodeURIComponent(realmSlug)}&name=${encodeURIComponent(name)}` +
    `&fields=mythic_plus_scores_by_season:current`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      cache: "no-store",
      signal: ctrl.signal,
      headers: { "User-Agent": "lib-site-announce/1.0" },
    });
    if (!r.ok) return null;
    const d = (await r.json()) as {
      mythic_plus_scores_by_season?: {
        scores?: { all?: number };
        segments?: { all?: { score?: number } };
      }[];
    };
    const s = d.mythic_plus_scores_by_season?.[0];
    // Match the snapshot builder's precedence: segments.all.score, then scores.all.
    const score = s?.segments?.all?.score ?? s?.scores?.all;
    return typeof score === "number" ? score : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export type OverlayResult = {
  /** Roster members considered (ran a key within the active window). */
  candidates: number;
  /** Members skipped as idle (no recent run — score can't have moved). */
  skipped: number;
  fetched: number;
  changed: { name: string; from: number | null; to: number }[];
};

/**
 * Overlay current RIO scores onto `snapshot.roster` in place — INCREMENTALLY.
 *
 * A score only changes after a member RUNS a key, so we re-fetch ONLY members
 * whose `lastRunAt` is within `activeWithinHours` (the active pushers, usually a
 * handful). Everyone idle is skipped — their score can't have jumped, so there's
 * nothing to catch. This keeps the per-run cost proportional to guild ACTIVITY,
 * not roster size, so it stays cheap even when run hourly (the CPU-frugal path
 * the site deliberately keeps). Bounded concurrency; per-member failure keeps
 * the snapshot value. Returns what moved (for the route log / dry-run).
 */
export async function overlayFreshScores(
  snapshot: GuildSnapshot,
  opts: { concurrency?: number; activeWithinHours?: number } = {},
): Promise<OverlayResult> {
  const { concurrency = 6, activeWithinHours = 48 } = opts;
  const cutoff = Date.now() - activeWithinHours * 60 * 60 * 1000;
  const all = snapshot.roster ?? [];
  const active = all.filter((c) => {
    if (!c?.name || !c?.realmSlug) return false;
    // lastRunAt is epoch-ms. It can lag the real last run by a crawl cycle, so
    // the 48h window is deliberately wide enough to absorb that and still catch
    // anyone genuinely active.
    const t = typeof c.lastRunAt === "number" ? c.lastRunAt : NaN;
    return Number.isFinite(t) && t >= cutoff;
  });

  let idx = 0;
  let fetched = 0;
  const changed: OverlayResult["changed"] = [];

  async function worker() {
    while (idx < active.length) {
      const c = active[idx++];
      const fresh = await fetchCurrentScore(c.realmSlug, c.name);
      if (fresh == null) continue; // keep the snapshot value
      fetched++;
      const prev = typeof c.mythicPlusScore === "number" ? c.mythicPlusScore : null;
      if (prev == null || Math.abs(fresh - prev) > 0.001) {
        changed.push({ name: c.name, from: prev, to: fresh });
        c.mythicPlusScore = fresh; // mutates the snapshot roster char in place
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, active.length || 1) }, worker),
  );
  return {
    candidates: active.length,
    skipped: all.length - active.length,
    fetched,
    changed,
  };
}
