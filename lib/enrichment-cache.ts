/**
 * Per-character enrichment cache (Upstash Redis).
 *
 * The hourly snapshot's biggest Active-CPU cost is `enrichRoster`: fetching and
 * JSON-parsing every member's ~10-15 MB RIO profile, then shaping ~100 runs
 * each — every hour, for all ~60 chars, even though most are idle. RIO only
 * changes a character's data when it re-crawls them, and the bulk guild
 * response exposes each member's `last_crawled_at` for free. So we cache the
 * shaped `EnrichedCharacter` keyed by that crawl timestamp: when a member's
 * `last_crawled_at` is unchanged, their profile is byte-identical to last hour
 * and we reuse the cached object instead of re-fetching + re-parsing it.
 *
 * This module is intentionally decoupled from the EnrichedCharacter type — it
 * stores/loads an opaque `enriched` payload — so raiderio.ts owns the shape and
 * there's no import cycle.
 *
 * FAILS SAFE: if Upstash isn't configured or any op throws, load returns an
 * empty map (→ every char is treated as a miss → full fetch, today's behaviour)
 * and save is a no-op. A Redis outage can never break the snapshot.
 */

import { getRedis } from "@/lib/announce-store";

/** Stored value: the shaped enrichment plus the crawl stamp that validates it. */
export type CachedEnrichment<T> = {
  /** RIO `character.last_crawled_at` at the time this was cached. The reuse
   *  gate requires the live value to match exactly. */
  lastCrawledAt: string;
  /** Opaque shaped enrichment (an EnrichedCharacter, from raiderio.ts). */
  enriched: T;
};

const KEY_PREFIX = "lib:enrich:v1:";
// Idle chars that fall off the roster (or go quiet for weeks) shouldn't pile up
// forever. 14 days comfortably exceeds any normal idle gap; a char idle longer
// just gets one cold re-fetch.
const TTL_SECONDS = 14 * 24 * 60 * 60;
// Upstash REST handles large mget/pipeline fine, but keep each round-trip
// bounded so one giant request can't trip a size/time limit.
const CHUNK = 24;

/** Build the Redis key for a character. Realm slug + lowercased name keeps it
 *  stable across RIO's mojibake name variants (caller passes the fixed name). */
export function enrichCacheKey(realmSlug: string, name: string): string {
  return `${KEY_PREFIX}${realmSlug}:${name.toLowerCase()}`;
}

/**
 * Load cached enrichments for the given keys. Returns a map of key → entry;
 * keys with no cached value (or any failure) are simply absent, so the caller
 * fetches them fresh.
 */
export async function loadEnrichmentCache<T>(
  keys: string[],
): Promise<Map<string, CachedEnrichment<T>>> {
  const out = new Map<string, CachedEnrichment<T>>();
  if (keys.length === 0) return out;
  const redis = getRedis();
  if (!redis) return out;
  try {
    const chunks: string[][] = [];
    for (let i = 0; i < keys.length; i += CHUNK) {
      chunks.push(keys.slice(i, i + CHUNK));
    }
    // Run the mget chunks concurrently — this is network latency, not CPU, so
    // fanning out keeps the load to ~one round-trip regardless of roster size.
    const chunkResults = await Promise.all(
      chunks.map((chunk) =>
        redis.mget<(CachedEnrichment<T> | null)[]>(...chunk),
      ),
    );
    chunkResults.forEach((values, ci) => {
      values.forEach((v, j) => {
        if (v && typeof v === "object" && "lastCrawledAt" in v) {
          out.set(chunks[ci][j], v);
        }
      });
    });
  } catch (err) {
    // Degrade to "no cache" — the snapshot still builds, just without the
    // savings this hour.
    console.warn("[enrichment-cache] load failed; fetching all fresh:", err);
    return new Map();
  }
  return out;
}

/**
 * Persist freshly-fetched enrichments. Best-effort: a failure here just means
 * next hour re-fetches those chars. Never throws.
 */
export async function saveEnrichmentCache<T>(
  entries: { key: string; value: CachedEnrichment<T> }[],
): Promise<void> {
  if (entries.length === 0) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    const chunks: (typeof entries)[] = [];
    for (let i = 0; i < entries.length; i += CHUNK) {
      chunks.push(entries.slice(i, i + CHUNK));
    }
    await Promise.all(
      chunks.map((chunk) => {
        const pipe = redis.pipeline();
        for (const e of chunk) {
          pipe.set(e.key, e.value, { ex: TTL_SECONDS });
        }
        return pipe.exec();
      }),
    );
  } catch (err) {
    console.warn("[enrichment-cache] save failed (non-fatal):", err);
  }
}

/**
 * True during the weekly M+ reset window, when RIO's weekly run buckets
 * (`weekly_highest_level_runs` / `previous_weekly_highest_level_runs`) shift and
 * the `last_crawled_at` gate alone could serve a stale bucket for an idle char.
 *
 * US reset is Tuesday 08:00 PT — 15:00 UTC under PDT, 16:00 UTC under PST. We
 * force a full (non-incremental) refresh on every snapshot run that falls in the
 * Tue 15:00–17:59 UTC window so a fresh fetch lands under both DST offsets,
 * re-caching correct post-reset buckets for the rest of the week. Costs ~3
 * non-incremental runs/week.
 */
export function isWeeklyResetWindow(now: Date = new Date()): boolean {
  return now.getUTCDay() === 2 && now.getUTCHours() >= 15 && now.getUTCHours() <= 17;
}
