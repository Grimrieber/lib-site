/**
 * Character-sheet detail persistence (Upstash Redis).
 *
 * The character page used to fetch its full detail (gear, stats, talents,
 * collections, pvp, raid encounters) LIVE from Blizzard/RIO on first view —
 * an ~8-13s cold fanout that intermittently crashed the on-demand ISR
 * generation in production (the "this page couldn't load" 500). Instead, the
 * hourly refresh now precomputes each character's detail and stores it here,
 * and the page just READS it (a few ms) — no live fetch, so the cold-gen
 * crash is structurally impossible.
 *
 * Reuses the same getRedis() (dual KV_ / UPSTASH_ naming) as the poll and
 * announce feed. Returns null when Upstash isn't configured so callers can
 * fall back to a live fetch (local dev without Redis) instead of crashing.
 *
 * One key per character holds the full CharacterDetail (with talents populated
 * — unlike the live path, which streams talents separately). A single stamps
 * map mirrors lib/raiderio's crawl-stamp gate so the generator only re-fetches
 * characters RIO has re-crawled.
 */

import { getRedis } from "@/lib/announce-store";
import type { CharacterDetail } from "@/lib/types";

// Bump when CharacterDetail's stored shape changes — a mismatch reads as a
// miss (→ live fallback / regeneration) rather than rendering stale fields.
export const CHAR_DETAIL_VERSION = 1;

const KEY_PREFIX = "char:detail:";
const STAMPS_KEY = "char:detail:stamps";

function detailKey(realmSlug: string, name: string): string {
  return `${KEY_PREFIX}${realmSlug.toLowerCase()}:${name.toLowerCase()}`;
}

type StoredDetail = {
  version: number;
  /** RIO last_crawled_at this detail was generated from (for the gate). */
  crawledAt?: string;
  storedAt: string;
  detail: CharacterDetail;
};

/** Read a character's precomputed detail. null when missing, version-stale, or
 *  Redis isn't configured — the caller then live-fetches as a fallback. */
export async function getStoredCharacterDetail(
  realmSlug: string,
  name: string,
): Promise<CharacterDetail | null> {
  const redis = getRedis();
  if (!redis) return null;
  const stored = await redis.get<StoredDetail>(detailKey(realmSlug, name));
  if (!stored || stored.version !== CHAR_DETAIL_VERSION) return null;
  return stored.detail;
}

export async function setStoredCharacterDetail(
  realmSlug: string,
  name: string,
  detail: CharacterDetail,
  crawledAt: string | undefined,
  nowIso: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(detailKey(realmSlug, name), {
    version: CHAR_DETAIL_VERSION,
    crawledAt,
    storedAt: nowIso,
    detail,
  } satisfies StoredDetail);
}

/** Map of `<realmSlug>:<nameLc>` -> last_crawled_at the stored detail was built
 *  from. One small read drives the incremental gate for the whole roster. */
export async function loadDetailStamps(): Promise<Record<string, string>> {
  const redis = getRedis();
  if (!redis) return {};
  return (await redis.get<Record<string, string>>(STAMPS_KEY)) ?? {};
}

export async function saveDetailStamps(
  stamps: Record<string, string>,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(STAMPS_KEY, stamps);
}
