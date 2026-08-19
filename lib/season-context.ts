import { REVALIDATE } from "./config";

const RIO_BASE = "https://raider.io/api/v1";

/**
 * ONE authoritative answer to "what season / expansion is current", derived
 * entirely from Raider.IO's static data at snapshot-build time and persisted on
 * the snapshot for every consumer to read.
 *
 * Why this module exists: "current" used to be re-derived independently in
 * about eight places — a hand-maintained list of past season slugs, two copies
 * of a hardcoded expansion-id scan range, a `season-mn-1` string literal as a
 * fallback, and a regex that string-munged slugs to enumerate seasons. Each
 * season and expansion rollover broke a different subset of them, which is why
 * the same class of bug kept reappearing under a new symptom. Anything that
 * needs to know the current season, its start time, or which seasons exist
 * should read this context rather than deriving its own answer.
 *
 * Everything here degrades to "keep the last known value" rather than to null,
 * so a Raider.IO outage during a rollover leaves the site STALE, never broken.
 */
export type SeasonInfo = {
  slug: string;
  expansionId: number;
  /** Unix ms of the US start, or 0 when RIO didn't date it. */
  startsAt: number;
  /** Unix ms of the US end, or 0 when open-ended / undated. */
  endsAt: number;
};

export type SeasonContext = {
  /** RIO's authoritative current season slug, e.g. "season-mn-2". */
  currentSeasonSlug: string | null;
  /** Unix ms the current season started (US). Null when unknown. */
  currentSeasonStartsAt: number | null;
  /** Expansion the current season belongs to, resolved by finding which
   *  expansion's season list CONTAINS the slug — no string parsing. */
  currentExpansionId: number | null;
  /** Every season RIO knows about, newest-first, across every expansion.
   *  Replaces the hand-maintained HISTORICAL_SEASON_SLUGS: a new expansion's
   *  seasons appear here automatically, and the just-finished expansion's
   *  seasons keep their score columns with no edit. */
  allSeasons: SeasonInfo[];
  /** MAIN seasons only, newest-first — what the per-season score columns ask
   *  for. Excludes RIO's short event/variant seasons (break-the-meta, cutoffs,
   *  legion-remix, post-patch windows), which are real seasons with real scores
   *  but would bury a character's actual history under novelty columns. */
  mainSeasonSlugs: string[];
  /** Which season this is WITHIN its expansion (1-based), derived from the
   *  ordinal position of its start date among that expansion's main seasons.
   *  Deliberately NOT parsed out of the slug: a trailing-digit regex is the
   *  same format assumption that broke the season chain, and it silently
   *  yields NaN for any descriptively-named season. Null when unresolvable. */
  currentSeasonNumber: number | null;
  /** Expansion ids RIO actually serves, ascending. Discovered, not hardcoded. */
  expansionIds: number[];
};

/** RIO's raid static-data starts at Legion. Ids below this are permanently
 *  unsupported (it 400s), so discovery starts here instead of probing from 0. */
const FIRST_RIO_EXPANSION_ID = 6;
/** Stop probing after this many consecutive unsupported ids. One gap would be
 *  unusual; two in a row means we're past the newest expansion. */
const PROBE_MISS_LIMIT = 2;
/** Hard ceiling so a RIO behaviour change can't spin this into an open loop.
 *  Well beyond any plausible expansion count — Midnight is 11. */
const PROBE_MAX_ID = 40;

/**
 * Which expansion ids Raider.IO actually serves.
 *
 * RIO answers `raiding/static-data` with HTTP 400 "Requested unsupported
 * expansion_id" for ids it doesn't know, which makes discovery exact: probe
 * upward from Legion until we hit consecutive misses. This replaces three
 * separate hardcoded id lists (`[20, 19, ... 6]` twice and an
 * EXPANSION_SCAN_MAX_ID ceiling) that would each have needed a manual bump.
 *
 * A network failure is NOT treated as "unsupported" — it doesn't advance the
 * miss counter, so a flaky request can't silently truncate the range and drop
 * an expansion's worth of history.
 */
export async function discoverExpansionIds(): Promise<number[]> {
  const ids: number[] = [];
  let misses = 0;
  for (let id = FIRST_RIO_EXPANSION_ID; id <= PROBE_MAX_ID; id++) {
    const supported = await probeExpansion(id);
    if (supported === false) {
      // RIO explicitly said this id doesn't exist. Consecutive misses mean
      // we're past the newest expansion.
      if (++misses >= PROBE_MISS_LIMIT) break;
      continue;
    }
    // true (exists) OR null (we never got a definitive answer). Unknown ids are
    // KEPT rather than skipped: dropping one silently loses an expansion's
    // worth of seasons and raid history, while keeping a non-existent one costs
    // a single wasted request downstream. Fail toward too much, never too
    // little — a flaky network must not quietly shrink the site's history.
    ids.push(id);
    misses = 0;
  }
  return ids;
}

/** True = RIO serves this expansion, false = RIO says it doesn't exist,
 *  null = we couldn't get a definitive answer (network/rate-limit). Retries
 *  transient failures, because a single dropped request used to be enough to
 *  lose Legion from the scan range. */
async function probeExpansion(id: number): Promise<boolean | null> {
  const ATTEMPTS = 3;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const res = await fetch(
        `${RIO_BASE}/raiding/static-data?expansion_id=${id}`,
        { next: { revalidate: REVALIDATE.raidStatic } },
      );
      if (res.ok) return true;
      // 400 is RIO's explicit "Requested unsupported expansion_id" — a real
      // answer, not a failure, so don't burn retries on it.
      if (res.status === 400) return false;
    } catch {
      // fall through to retry
    }
  }
  return null;
}


/**
 * Keep only MAIN seasons, dropping RIO's short event/variant seasons.
 *
 * A variant's slug EXTENDS the season it hangs off: "season-mn-1-break-the-meta"
 * off "season-mn-1", "season-tww-3-cutoffs" off "season-tww-3". Detecting that
 * structurally — rather than pattern-matching `season-<abbrev>-<number>` — is
 * the whole point. RIO already ships descriptively-named content (the raid
 * "the-venomous-abyss"), and a slug-format assumption is precisely what broke
 * the season chain at the S1->S2 rollover. A future main season named anything
 * at all survives this filter; only slugs built ON TOP of another season drop.
 *
 * Input order is preserved, so callers control newest-first ordering.
 */
export function selectMainSeasons(slugs: string[]): string[] {
  const all = new Set(slugs);
  return slugs.filter((slug) => {
    for (const other of all) {
      if (other !== slug && slug.startsWith(`${other}-`)) return false;
    }
    return true;
  });
}

/** Every M+ season RIO lists for one expansion. */
async function fetchSeasonsForExpansion(
  expansionId: number,
): Promise<SeasonInfo[]> {
  try {
    const res = await fetch(
      `${RIO_BASE}/mythic-plus/static-data?expansion_id=${expansionId}`,
      { next: { revalidate: REVALIDATE.raidStatic } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      seasons?: { slug?: string; starts?: { us?: string }; ends?: { us?: string } }[];
    };
    return (data.seasons ?? [])
      .filter((s): s is { slug: string; starts?: { us?: string }; ends?: { us?: string } } =>
        typeof s.slug === "string" && s.slug.length > 0,
      )
      .map((s) => {
        const startsAt = Date.parse(s.starts?.us ?? "");
        const endsAt = Date.parse(s.ends?.us ?? "");
        return {
          slug: s.slug,
          expansionId,
          startsAt: Number.isFinite(startsAt) ? startsAt : 0,
          endsAt: Number.isFinite(endsAt) ? endsAt : 0,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Assemble the context. `currentSeasonSlug` comes from RIO's `:current` on a
 * live character profile (the only source that flips exactly at the boundary);
 * everything else is derived from static data around it.
 *
 * Returns null only when discovery produced nothing at all, which callers must
 * treat as "carry the previous context forward" rather than as a fresh start.
 */
export async function buildSeasonContext(
  currentSeasonSlug: string | null,
): Promise<SeasonContext | null> {
  const expansionIds = await discoverExpansionIds();
  if (expansionIds.length === 0) return null;

  const perExpansion = await Promise.all(
    expansionIds.map((id) => fetchSeasonsForExpansion(id)),
  );
  const allSeasons = perExpansion
    .flat()
    // Newest-first. Undated seasons (startsAt 0) sort last rather than first,
    // so a season RIO hasn't dated can't displace the real current one.
    .sort((a, b) => b.startsAt - a.startsAt);
  if (allSeasons.length === 0) return null;

  const mainSeasonSlugs = selectMainSeasons(allSeasons.map((x) => x.slug));

  const currentEntry = currentSeasonSlug
    ? allSeasons.find((s) => s.slug === currentSeasonSlug)
    : undefined;

  // Season number = position among this expansion's main seasons, oldest
  // first. Works for "season-mn-2" and for a season named anything at all.
  const mainSet = new Set(mainSeasonSlugs);
  const currentSeasonNumber = currentEntry
    ? (() => {
        const withinExpansion = allSeasons
          .filter(
            (x) =>
              x.expansionId === currentEntry.expansionId &&
              mainSet.has(x.slug),
          )
          .sort((a, b) => a.startsAt - b.startsAt);
        const idx = withinExpansion.findIndex(
          (x) => x.slug === currentEntry.slug,
        );
        return idx >= 0 ? idx + 1 : null;
      })()
    : null;

  return {
    currentSeasonSlug,
    currentSeasonStartsAt: currentEntry?.startsAt || null,
    currentExpansionId: currentEntry?.expansionId ?? null,
    currentSeasonNumber,
    allSeasons,
    mainSeasonSlugs,
    expansionIds,
  };
}

/**
 * A raid belongs to the current season when it opened within a grace window
 * before the season start.
 *
 * The window is REQUIRED, not defensive padding: RIO dates a tier's opening
 * about a week AHEAD of the season it anchors (MN Tier 1 opened 2026-03-17 for
 * a season starting 2026-03-24). A naive `startsAt >= seasonStart` orphans a
 * raid from its own season and files live content as history.
 */
export const SEASON_RAID_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export function raidBelongsToSeason(
  raidStartsAtMs: number | null | undefined,
  seasonStartsAtMs: number | null | undefined,
): boolean {
  // Fail open on either side: without a boundary we keep the raid visible
  // rather than hide progress the guild actually earned.
  if (seasonStartsAtMs == null || !Number.isFinite(seasonStartsAtMs)) return true;
  if (raidStartsAtMs == null || !Number.isFinite(raidStartsAtMs)) return true;
  return raidStartsAtMs >= seasonStartsAtMs - SEASON_RAID_GRACE_MS;
}
