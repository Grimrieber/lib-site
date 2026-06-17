/**
 * Snapshot-pipeline incremental caches (Upstash Redis).
 *
 * Two heavy per-character parses run on the hourly/twice-daily crons, both
 * gated here so unchanged characters are reused instead of re-fetched+re-parsed:
 *
 *   1. enrichRoster — the ~10-15 MB RIO profile per char (hourly, ~359 chars).
 *      Gate signal: RIO `character.last_crawled_at` from the bulk guild
 *      response. Unchanged stamp ⇒ RIO hasn't re-crawled ⇒ profile identical.
 *
 *   2. getRosterEnrichmentsLive — the ~2.67 MB BNet achievements blob per char
 *      (twice daily, ~64 chars) → tier badges, season titles, recent-cheevo
 *      feed. Gate signal: `achievement_points` from the same guild response.
 *      Unchanged points ⇒ no new achievement ⇒ all derived data identical.
 *
 * Both caches share one generic, chunked, concurrent, FAIL-SAFE core: if Upstash
 * isn't configured or any op throws, load returns an empty map (→ everything is
 * a miss → full fetch, the pre-cache behaviour) and save is a no-op. A Redis
 * outage can never break a snapshot.
 */

import { getRedis } from "@/lib/announce-store";

// Idle chars that fall off the roster shouldn't pile up forever. 14 days
// comfortably exceeds any normal idle gap; a longer-idle char gets one cold
// re-fetch when its key expires.
const TTL_SECONDS = 14 * 24 * 60 * 60;
// Keep each Upstash round-trip bounded so one giant request can't trip a
// size/time limit; chunks run concurrently, so this isn't a latency cost.
const CHUNK = 24;

// ----------------------------------------------------------------------------
// Generic core — chunked + concurrent mget/mset, fail-safe.
// ----------------------------------------------------------------------------

function chunk<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

/** Read keys into a map, dropping anything that fails `valid`. Absent/invalid
 *  keys are simply missing → caller fetches them fresh. Empty map on any error. */
async function loadKeyed<V>(
  keys: string[],
  valid: (v: unknown) => v is V,
): Promise<Map<string, V>> {
  const out = new Map<string, V>();
  if (keys.length === 0) return out;
  const redis = getRedis();
  if (!redis) return out;
  try {
    const chunks = chunk(keys);
    const results = await Promise.all(
      chunks.map((c) => redis.mget<(V | null)[]>(...c)),
    );
    results.forEach((values, ci) => {
      values.forEach((v, j) => {
        if (valid(v)) out.set(chunks[ci][j], v);
      });
    });
  } catch (err) {
    console.warn("[snapshot-cache] load failed; fetching all fresh:", err);
    return new Map();
  }
  return out;
}

/** Persist key/value pairs with the shared TTL. Best-effort; never throws. */
async function saveKeyed<V>(
  entries: { key: string; value: V }[],
): Promise<void> {
  if (entries.length === 0) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    await Promise.all(
      chunk(entries).map((group) => {
        const pipe = redis.pipeline();
        for (const e of group) pipe.set(e.key, e.value, { ex: TTL_SECONDS });
        return pipe.exec();
      }),
    );
  } catch (err) {
    console.warn("[snapshot-cache] save failed (non-fatal):", err);
  }
}

// ----------------------------------------------------------------------------
// (1) enrichRoster cache — keyed by RIO last_crawled_at.
// ----------------------------------------------------------------------------

export type CachedEnrichment<T> = {
  /** RIO `character.last_crawled_at` when this was cached. Reuse requires an
   *  exact match against the live value. */
  lastCrawledAt: string;
  /** Opaque shaped enrichment (an EnrichedCharacter, from raiderio.ts). */
  enriched: T;
};

export function enrichCacheKey(realmSlug: string, name: string): string {
  return `lib:enrich:v1:${realmSlug}:${name.toLowerCase()}`;
}

export function loadEnrichmentCache<T>(
  keys: string[],
): Promise<Map<string, CachedEnrichment<T>>> {
  return loadKeyed<CachedEnrichment<T>>(
    keys,
    (v): v is CachedEnrichment<T> =>
      !!v && typeof v === "object" && "lastCrawledAt" in v,
  );
}

export function saveEnrichmentCache<T>(
  entries: { key: string; value: CachedEnrichment<T> }[],
): Promise<void> {
  return saveKeyed(entries);
}

// ----------------------------------------------------------------------------
// (2) achievements/tier-data cache — keyed by achievement_points.
// ----------------------------------------------------------------------------

export type CachedTier<T> = {
  /** RIO `character.achievement_points` when this was cached. Any achievement
   *  earned bumps points, so an unchanged value means none of the derived data
   *  (tier badges, season titles, recent feed) can have changed. */
  points: number;
  /** Opaque tier data (a CharacterTierData, from battlenet.ts). */
  tier: T;
};

export function tierCacheKey(realmSlug: string, name: string): string {
  // v2: CharacterTierData.notableRecent (notable-only) was replaced by
  // recentEarned (every recent achievement). Bumping the key version cold-
  // misses all v1 entries so they re-fetch into the new shape on the next run,
  // instead of feeding stale objects that lack `recentEarned` to the feed.
  return `lib:tier:v2:${realmSlug}:${name.toLowerCase()}`;
}

export function loadTierCache<T>(
  keys: string[],
): Promise<Map<string, CachedTier<T>>> {
  return loadKeyed<CachedTier<T>>(
    keys,
    (v): v is CachedTier<T> =>
      !!v && typeof v === "object" && typeof (v as CachedTier<T>).points === "number",
  );
}

export function saveTierCache<T>(
  entries: { key: string; value: CachedTier<T> }[],
): Promise<void> {
  return saveKeyed(entries);
}

// ----------------------------------------------------------------------------
// (3) character-page achievements-SUMMARY cache — keyed by achievement_points.
// ----------------------------------------------------------------------------
//
// The character page's Achievements tab needs the BNet ~2.67MB achievements
// blob shaped into a small summary (totals + recent + top categories). That
// blob exceeds Next's 2MB fetch-cache limit, so it re-fetches + re-parses on
// every ISR regeneration. Same gate as the tier cache: `achievement_points`
// — unchanged ⇒ no new achievement ⇒ the summary can't have changed ⇒ serve
// the cached object instead of re-parsing 2.67MB. Separate key from the tier
// cache so the snapshot-enrichments path is untouched.

export type CachedAchSummary<T> = {
  /** RIO `character.achievement_points` when this was cached. */
  points: number;
  /** Opaque achievements summary (an AchievementSummary, from battlenet.ts). */
  summary: T;
};

export function achSummaryCacheKey(realmSlug: string, name: string): string {
  return `lib:achsum:v1:${realmSlug}:${name.toLowerCase()}`;
}

export function loadAchSummaryCache<T>(
  keys: string[],
): Promise<Map<string, CachedAchSummary<T>>> {
  return loadKeyed<CachedAchSummary<T>>(
    keys,
    (v): v is CachedAchSummary<T> =>
      !!v &&
      typeof v === "object" &&
      typeof (v as CachedAchSummary<T>).points === "number",
  );
}

export function saveAchSummaryCache<T>(
  entries: { key: string; value: CachedAchSummary<T> }[],
): Promise<void> {
  return saveKeyed(entries);
}

// ----------------------------------------------------------------------------
// (4) character-page CharacterCore cache — keyed by RIO last_crawled_at.
// ----------------------------------------------------------------------------
//
// The /character/[realm]/[name] hero path fetches + parses each character's
// full RIO profile (gear, 15 seasons, ranks, raid, runs) on EVERY ISR
// regeneration — no per-char skip, unlike the snapshot pipeline. That parse is
// the site's top Active-CPU line (volume × ~0.5s). Cache the shaped
// `CharacterCore` here, gated on the SAME `last_crawled_at` the snapshot
// already records (read from the enrich cache — no extra profile fetch needed
// to learn the gate). Unchanged crawl stamp ⇒ RIO data unchanged ⇒ reuse the
// shaped core, skipping the fetch+parse entirely. Idle chars (the bulk of
// crawler-driven regenerations) collapse to a cheap Upstash read.

export type CachedCore<T> = {
  /** RIO `last_crawled_at` (from the enrich cache) when this core was shaped. */
  lastCrawledAt: string;
  /** Opaque shaped CharacterCore (from raiderio.ts). */
  core: T;
};

export function coreCacheKey(realmSlug: string, name: string): string {
  return `lib:charcore:v1:${realmSlug}:${name.toLowerCase()}`;
}

export function loadCoreCache<T>(
  keys: string[],
): Promise<Map<string, CachedCore<T>>> {
  return loadKeyed<CachedCore<T>>(
    keys,
    (v): v is CachedCore<T> =>
      !!v &&
      typeof v === "object" &&
      typeof (v as CachedCore<T>).lastCrawledAt === "string" &&
      "core" in (v as object),
  );
}

export function saveCoreCache<T>(
  entries: { key: string; value: CachedCore<T> }[],
): Promise<void> {
  return saveKeyed(entries);
}

// ----------------------------------------------------------------------------
// (5) guild crawl-stamps map — one key, {realmSlug:nameLc -> last_crawled_at}.
// ----------------------------------------------------------------------------
//
// enrichRoster processes the FULL ~359-member raider-rank list every run just to
// find the ~66 active (the activity filter needs each char's enriched
// score/kills/lastRunAt). This map lets it skip the ~293 who were inactive AND
// whose RIO crawl stamp is unchanged since last run — they can't have become
// active, so there's no need to even LOAD their cached object. One small GET +
// SET per run replaces ~293 heavy cache loads. Fails safe (empty → process all).

const CRAWL_STAMPS_KEY = "lib:crawlstamps:v1";

export async function loadCrawlStamps(): Promise<Record<string, string>> {
  const redis = getRedis();
  if (!redis) return {};
  try {
    const v = await redis.get<Record<string, string>>(CRAWL_STAMPS_KEY);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch (err) {
    console.warn("[snapshot-cache] crawl-stamps load failed:", err);
    return {};
  }
}

export async function saveCrawlStamps(
  stamps: Record<string, string>,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(CRAWL_STAMPS_KEY, stamps, { ex: TTL_SECONDS });
  } catch (err) {
    console.warn("[snapshot-cache] crawl-stamps save failed (non-fatal):", err);
  }
}

// ----------------------------------------------------------------------------

/**
 * True during the weekly M+ reset window, when RIO's weekly run buckets shift
 * and the `last_crawled_at` gate alone could serve a stale bucket for an idle
 * char. US reset is Tue 08:00 PT — 15:00 UTC (PDT) / 16:00 UTC (PST). Forcing a
 * full refresh across Tue 15:00–17:59 UTC lands a fresh fetch under both
 * offsets. (Only the enrichRoster cache needs this; the tier cache is gated on
 * achievement_points, which has no weekly component.)
 */
export function isWeeklyResetWindow(now: Date = new Date()): boolean {
  return now.getUTCDay() === 2 && now.getUTCHours() >= 15 && now.getUTCHours() <= 17;
}
