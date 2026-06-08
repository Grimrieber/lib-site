/**
 * Discord announcement — baseline persistence (Upstash Redis).
 *
 * One JSON blob under `announce:baseline` holds the entire dedup/cadence
 * state (see AnnounceBaseline). The same Upstash instance already backs the
 * census poll; we reuse the identical dual-naming `getRedis()` so the same
 * code runs locally and on Vercel regardless of how the keys were provisioned.
 *
 * Returns null when Upstash isn't configured so the route can 503 cleanly
 * (mirrors the poll's pre-setup behaviour) instead of crashing.
 */

import { Redis } from "@upstash/redis";
import {
  ANNOUNCE_VERSION,
  EMPTY_BASELINE,
  type AnnounceBaseline,
} from "@/lib/announce-detect";

const BASELINE_KEY = "announce:baseline";

export function getRedis(): Redis | null {
  // Accept either naming convention: the Vercel↔Upstash integration injects
  // KV_REST_API_*, a plain Upstash account uses UPSTASH_REDIS_REST_*.
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/**
 * Load the baseline. Returns a fresh EMPTY_BASELINE (seeded: false) when no
 * state exists yet or the stored version is older than the current schema —
 * either way the route's seed path takes over from a clean slate.
 */
export async function loadBaseline(redis: Redis): Promise<AnnounceBaseline> {
  const stored = await redis.get<AnnounceBaseline>(BASELINE_KEY);
  if (!stored || stored.version !== ANNOUNCE_VERSION) {
    return { ...EMPTY_BASELINE };
  }
  return stored;
}

export async function saveBaseline(
  redis: Redis,
  baseline: AnnounceBaseline,
): Promise<void> {
  await redis.set(BASELINE_KEY, baseline);
}

/** Wipe the baseline — used by the seed endpoint's `force` reset. */
export async function clearBaseline(redis: Redis): Promise<void> {
  await redis.del(BASELINE_KEY);
}
