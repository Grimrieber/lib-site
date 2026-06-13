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
  return `lib:tier:v1:${realmSlug}:${name.toLowerCase()}`;
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
