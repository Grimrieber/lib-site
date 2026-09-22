/**
 * The snapshot as a RUNTIME value instead of a build-time import.
 *
 * WHY THIS EXISTS
 *
 * `data/snapshot.json` used to reach the site exactly one way: a static
 * `import` in lib/raiderio.ts. That made every data refresh a code change —
 * the cron committed a 0.5 MB JSON file and Vercel rebuilt all 35 functions to
 * ship it. 227 of the 249 deployments in a 30-day window existed for nothing
 * else, and at roughly 162 MB of function bundle per deployment that burned
 * the 10 GB free Function Storage tier in about eight days, twice.
 *
 * Pruning deployments could never fix that: the meter counts what gets
 * CREATED, and three retained deployments only accounted for ~0.5 GB of the
 * 10 GB. The fix is to stop creating them, which means the snapshot has to
 * arrive without a build. The cron now publishes it here, and the running
 * deployment picks it up on its next ISR revalidation.
 *
 * FAIL-SAFE BY CONSTRUCTION
 *
 * The bundled import stays as the seed and the fallback. Every failure here —
 * no Redis configured, a network error, malformed or truncated data, an entry
 * older than the bundle — returns null and leaves the caller on the bundled
 * copy. A Redis outage costs freshness, never the site. That is deliberate:
 * the last two incidents on this project were a data path that could fail
 * closed, and this one is on the render path of every page.
 *
 * Stored gzipped + base64: the file is ~487 KB raw and ~30 KB compressed, so
 * this is a 12x cut in Upstash bandwidth on a value read by every cold render.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { getRedis } from "@/lib/announce-store";
import type { Character, GuildAchievement, GuildSnapshot } from "@/lib/types";

/** Shape of `data/snapshot.json` — the composed cron output. */
export type SnapshotFile = {
  exportedAt?: string;
  mergeCount?: number;
  rosterSize?: number;
  snapshot: GuildSnapshot;
  enrichedRoster: Character[];
  recentAchievements: GuildAchievement[];
  enrichmentsExportedAt?: string;
};

/**
 * v1 — gzip+base64 of the composed file.
 *
 * Bump this if the ENCODING changes. It does not need a bump when the snapshot
 * gains fields: readers already tolerate missing ones (that is what
 * SNAPSHOT_SCHEMA_VERSION tracks), and a bump would blank the runtime copy
 * until the next cron, dropping the whole deployment back to a bundle that may
 * by then be weeks old.
 */
export const RUNTIME_SNAPSHOT_KEY = "lib:snapshot:v1";

/** Two weeks. Long enough that a stalled cron degrades gradually rather than
 *  falling off a cliff; the freshness comparison below is the real guard. */
const TTL_SECONDS = 14 * 24 * 60 * 60;

/** How long Next's data cache may hold the published blob. Well under the
 *  cron's ~2h cadence, so a publish is visible on the next page revalidation
 *  rather than a cycle later, and still cheap: one upstream read per window. */
const RUNTIME_FETCH_REVALIDATE_SECONDS = 60;

export function encodeSnapshotFile(file: SnapshotFile): string {
  return gzipSync(Buffer.from(JSON.stringify(file), "utf8")).toString("base64");
}

export function decodeSnapshotFile(raw: string): SnapshotFile | null {
  try {
    const json = gunzipSync(Buffer.from(raw, "base64")).toString("utf8");
    const parsed = JSON.parse(json) as SnapshotFile;
    // Minimum viable shape. A truncated or half-written value must not be
    // allowed to replace a good bundle with something that renders an empty
    // guild — better to serve yesterday's data than today's nothing.
    if (!parsed?.snapshot || !Array.isArray(parsed.snapshot.roster)) return null;
    if (parsed.snapshot.roster.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** When this file was built, as epoch ms; NaN when it carries no usable stamp. */
export function snapshotStampMs(file: Pick<SnapshotFile, "snapshot" | "exportedAt">): number {
  const candidates = [file.snapshot?.fetchedAt, file.exportedAt];
  for (const c of candidates) {
    const t = Date.parse(c ?? "");
    if (Number.isFinite(t)) return t;
  }
  return Number.NaN;
}

/**
 * Read the published snapshot, or null to stay on the bundled copy.
 *
 * Never throws and never logs at error level for the ordinary "not configured"
 * case — this runs on the render path.
 */
export async function readRuntimeSnapshot(
  opts: { fresh?: boolean } = {},
): Promise<SnapshotFile | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    // DELIBERATELY A RAW FETCH, NOT THE @upstash/redis CLIENT.
    //
    // That client sends `cache: "no-store"`, and a no-store fetch inside a
    // statically rendered route throws DynamicServerError — which would make
    // every ISR page fall back to the bundled copy forever and quietly undo
    // this entire change. The build surfaced it on /about and /opengraph-image;
    // `next dev` does not, which is how a bug of exactly this shape once took
    // every character page down in production.
    //
    // A revalidating fetch is also the semantically correct thing here: this is
    // a read-mostly blob behind ISR pages, so letting Next's data cache own the
    // refresh window means one upstream read per window per region rather than
    // one per render.
    //
    // `fresh` bypasses that cache. The publish route needs it: it compares the
    // incoming file against what is already stored to reject stale or gutted
    // payloads, and a comparison against an up-to-60s-old copy would both
    // reject legitimate publishes and let a regression through. Only callers
    // that are already `force-dynamic` may pass it — a no-store fetch inside a
    // static render is the DynamicServerError described above.
    const res = await fetch(
      `${url}/get/${RUNTIME_SNAPSHOT_KEY}`,
      opts.fresh
        ? { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
        : {
            headers: { Authorization: `Bearer ${token}` },
            next: { revalidate: RUNTIME_FETCH_REVALIDATE_SECONDS },
          },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: unknown };
    const raw = body?.result;
    if (typeof raw !== "string" || raw.length === 0) return null;
    return decodeSnapshotFile(raw);
  } catch (err) {
    console.error("[snapshot-store] read failed; using bundled copy", err);
    return null;
  }
}

/**
 * Publish a snapshot for running deployments to pick up.
 *
 * Returns false rather than throwing so the cron's commit step still runs when
 * Redis is unavailable — the committed file remains the durable record, and a
 * deploy would still ship it the old way.
 */
export async function writeRuntimeSnapshot(file: SnapshotFile): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.set(RUNTIME_SNAPSHOT_KEY, encodeSnapshotFile(file), {
      ex: TTL_SECONDS,
    });
    return true;
  } catch (err) {
    console.error("[snapshot-store] publish failed", err);
    return false;
  }
}
