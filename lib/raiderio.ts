import type {
  AchievementSummary,
  Affix,
  Boss,
  BossKill,
  Character,
  CharacterCore,
  CharacterDetail,
  CharacterSeasonTitle,
  CharacterWeeklyKeys,
  Difficulty,
  GearItem,
  GuildAchievement,
  GuildRanking,
  GuildRun,
  GuildRunner,
  GuildSnapshot,
  KillParticipant,
  MythicPlusRun,
  PastRaidDetail,
  RaidClear,
  RaidEncountersData,
  RaidTierBadges,
  Rank,
  ResilientAchievement,
  Role,
  RunVideo,
  SeasonScore,
  SeasonTitleAward,
  SubRaid,
  TierState,
  WeeklyAffixes,
  WowClass,
} from "./types";
import {
  CURRENT_TIER_FINAL_BOSS,
  DEPARTURE_GRACE_HOURS,
  ENRICHMENT_CONCURRENCY,
  expansionLabelFromSlug,
  GUILD,
  GUILD_LEADER_CHARACTERS,
  GUILD_LEADER_GROUPS,
  OFFICER_RANK_THRESHOLD,
  GUILD_LEADER_LABEL,
  RAIDER_RANKS,
  RAID_NAME_OVERRIDES,
  RANK_LABELS,
  REVALIDATE,
  ROSTER_FILTER,
  ROSTER_PINS,
  SEASON_TITLE_OVERRIDES,
  SEASON_TITLE_SCAN_LIMIT,
  TIER_SUB_RAIDS,
} from "./config";
import bundledSnapshotFile from "@/data/snapshot.json";
import {
  achSummaryCacheKey,
  enrichCacheKey,
  isWeeklyResetWindow,
  loadAchSummaryCache,
  loadEnrichmentCache,
  loadTierCache,
  saveAchSummaryCache,
  saveEnrichmentCache,
  saveTierCache,
  tierCacheKey,
  type CachedEnrichment,
} from "./enrichment-cache";
import {
  getCharacterAchievements,
  getCharacterAvatar,
  getCharacterCollections,
  getCharacterEquipment,
  getCharacterLastRaidKill,
  getCharacterPvp,
  getCharacterRaidEncounters,
  getCharacterStats,
  getCharacterTierData,
  type CharacterTierData,
  getGuildRaidHistory,
  getRaidTileUrlByName,
  normalizeBossNameKey,
  resolveRaidBossIcons,
} from "./battlenet";

const RIO_BASE = "https://raider.io/api/v1";

type RioMember = {
  rank: number;
  character: {
    name: string;
    race: string;
    class: string;
    active_spec_name: string;
    active_spec_role: "TANK" | "HEALING" | "DPS";
    faction: "alliance" | "horde";
    realm: string;
    profile_url: string;
    /** ISO8601 of RIO's last crawl of this character. Present in the bulk
     *  guild-members response; drives the enrichment-cache reuse gate
     *  (unchanged stamp ⇒ profile unchanged ⇒ reuse cached enrichment). */
    last_crawled_at?: string;
    /** Total achievement points. Also in the bulk response; gates the
     *  achievements-blob (tier-data) cache (unchanged ⇒ no new cheevo). */
    achievement_points?: number;
  };
};

type RioGuildResponse = {
  name: string;
  faction: "alliance" | "horde";
  realm: string;
  raid_progression?: Record<
    string,
    {
      summary: string;
      total_bosses: number;
      normal_bosses_killed: number;
      heroic_bosses_killed: number;
      mythic_bosses_killed: number;
    }
  >;
  raid_rankings?: Record<
    string,
    Record<"normal" | "heroic" | "mythic", { world: number; region: number; realm: number }>
  >;
  members: RioMember[];
};

type RioRaid = {
  slug: string;
  name: string;
  short_name: string;
  starts: { us: string };
  encounters: { slug: string; name: string }[];
};

type RioStaticData = { raids: RioRaid[] };

let snapshotCache: { value: GuildSnapshot; expiresAt: number } | null = null;
/** Lets the snapshot-export endpoint force a fresh fetch when building
 *  the persistent fallback JSON — multi-fetch + merge averages out
 *  individual RIO partial responses into a complete roster. Also blows
 *  away the per-character core cache so character pages pick up the same
 *  fresh data (otherwise they'd serve a stale CharacterCore for another
 *  CHARACTER_CORE_TTL_MS after a manual snapshot rebuild). */
export function invalidateSnapshotCache(): void {
  snapshotCache = null;
  // Character core + detail caches are declared later in this module;
  // since this function only runs in response to HTTP requests (well
  // after module init), the references are safe. Clearing both keeps
  // the character page hero / loadout in sync with a manual snapshot
  // rebuild — otherwise a 5-min stale CharacterDetail would still serve
  // even after the snapshot pipeline got fresh data.
  characterCoreCache.clear();
  characterCoreInFlight.clear();
  characterDetailCache.clear();
  characterDetailInFlight.clear();
}
let enrichmentsCache: {
  value: RosterEnrichments;
  expiresAt: number;
} | null = null;
/**
 * In-flight promise for `getRosterEnrichments`. Concurrent callers (e.g. two
 * Suspense boundaries on the home page) share this so we never fan out the
 * 50× 2MB BNet achievements fetch more than once per cold cache.
 */
let enrichmentsInFlight: Promise<RosterEnrichments> | null = null;

/**
 * BNet-derived roster enrichments — tier badges per character + a feed of
 * notable recent achievements across the active roster. Decoupled from the
 * core `getGuildSnapshot()` because the per-character achievement endpoints
 * are heavy (~2MB each), and we don't want to block layout/header rendering
 * on a fanout of 50 of them.
 *
 * Pages that surface badges/achievements should fetch this independently —
 * ideally inside a Suspense boundary so the rest of the page renders while
 * this loads.
 */
export type RosterEnrichments = {
  enrichedRoster: Character[];
  recentAchievements: GuildAchievement[];
};

const RECENT_ACHIEVEMENTS_LIMIT = 50;

export async function getRosterEnrichments(): Promise<RosterEnrichments> {
  return bundledEnrichments;
}

export async function getRosterEnrichmentsLive(): Promise<RosterEnrichments> {
  if (enrichmentsCache && enrichmentsCache.expiresAt > Date.now()) {
    return enrichmentsCache.value;
  }
  if (enrichmentsInFlight) return enrichmentsInFlight;
  enrichmentsInFlight = (async () => {
    try {
      const snapshot = await getGuildSnapshotLive();
      // Incremental: the achievements blob (~2.67 MB/char) only changes when a
      // character earns an achievement, which always bumps `achievementPoints`.
      // So reuse the cached tier data for any char whose points are unchanged,
      // skipping the BNet fetch + parse. Same fail-safe cache as enrichRoster.
      const tierKeys = snapshot.roster.map((c) =>
        tierCacheKey(c.realmSlug, c.name),
      );
      const tierCache = await loadTierCache<CharacterTierData>(tierKeys);
      const tierToCache: {
        key: string;
        value: { points: number; tier: CharacterTierData };
      }[] = [];
      // Per-character try/catch so one BNet hiccup (rate limit, malformed
      // response on a transferred character, etc.) doesn't reject the
      // whole enrichments promise and crash the Suspense boundary.
      const tierData = await mapWithConcurrency(
        snapshot.roster,
        ENRICHMENT_CONCURRENCY,
        async (c) => {
          const key = tierCacheKey(c.realmSlug, c.name);
          const points = c.achievementPoints;
          const hit = points != null ? tierCache.get(key) : undefined;
          if (hit && hit.points === points) return hit.tier;
          try {
            const fresh = await getCharacterTierData(
              c.realmSlug,
              c.name,
              CURRENT_TIER_FINAL_BOSS,
            );
            // Cache only complete results with a points stamp to validate
            // against — never freeze a transient BNet failure (null).
            if (fresh && points != null) {
              tierToCache.push({ key, value: { points, tier: fresh } });
            }
            return fresh;
          } catch (err) {
            console.error(
              "[enrichments] tier-data failed for",
              c.name,
              err,
            );
            return null;
          }
        },
      );
      await saveTierCache(tierToCache);
      const enrichedRoster: Character[] = snapshot.roster.map((c, i) => ({
        ...c,
        tierBadges: tierData[i]?.tierBadges,
        seasonTitles: applyCharacterSeasonTitleOverrides(
          c.name,
          tierData[i]?.seasonTitles ?? [],
        ),
      }));

      // BNet's recent_events is unbounded in time — could include a
      // 2-year-old AOTC. Filter to the last 90 days so the feed shows
      // genuinely recent wins.
      const recentCutoff = Date.now() - 90 * 24 * 3600 * 1000;
      // Account-wide achievements (delve/Glory metas, exploration, etc.) appear
      // IDENTICALLY on every alt of a player's account — same achievement id at
      // the same timestamp — so a member with multiple guild alts double-posts
      // the same win (e.g. the Churd/Churdicus warband both posting "Glory of
      // the Midnight Delver"). Dedupe to one entry per account. claimedOwner
      // would be the ideal account key but only resolves for *claimed* RIO
      // characters; unclaimed alts have none. BNet total achievement points ARE
      // account-wide — every alt reports the same total — so (realm + points)
      // is a reliable account fingerprint even when unclaimed. Raid-mates who
      // earned the same boss achievement at the same second have DIFFERENT point
      // totals, so they stay separate. Keep the highest-M+-score alt (the main).
      const dedup = new Map<string, { ach: GuildAchievement; score: number }>();
      // Chars with no points stamp can't be fingerprinted — keep them as-is
      // rather than risk collapsing unrelated members under a shared null key.
      const unkeyed: GuildAchievement[] = [];
      for (let i = 0; i < snapshot.roster.length; i++) {
        const td = tierData[i];
        if (!td) continue;
        const c = snapshot.roster[i];
        const runner: GuildRunner = {
          name: c.name,
          realmSlug: c.realmSlug,
          class: c.class,
        };
        const score = c.mythicPlusScore ?? 0;
        const acctKey =
          c.achievementPoints != null
            ? `${c.realmSlug.toLowerCase()}:${c.achievementPoints}`
            : null;
        for (const a of td.notableRecent) {
          if (a.timestamp < recentCutoff) continue;
          const ach: GuildAchievement = { ...a, character: runner };
          if (!acctKey) {
            unkeyed.push(ach);
            continue;
          }
          const key = `${acctKey}:${a.id}:${a.timestamp}`;
          const prev = dedup.get(key);
          if (!prev || score > prev.score) dedup.set(key, { ach, score });
        }
      }
      const achievements: GuildAchievement[] = [
        ...unkeyed,
        ...[...dedup.values()].map((v) => v.ach),
      ];
      achievements.sort((a, b) => b.timestamp - a.timestamp);

      const value: RosterEnrichments = {
        enrichedRoster,
        recentAchievements: achievements.slice(0, RECENT_ACHIEVEMENTS_LIMIT),
      };
      enrichmentsCache = { value, expiresAt: Date.now() + 60 * 60 * 1000 };
      return value;
    } finally {
      enrichmentsInFlight = null;
    }
  })();
  return enrichmentsInFlight;
}

let snapshotInFlight: Promise<GuildSnapshot> | null = null;

/**
 * Past-tier raid history with per-raid Mythic kill counts. Heavy to compute
 * (probes Mythic boss-kill for every boss in every past raid the guild has
 * touched — easily 100+ RIO calls on cold cache), so kept off the snapshot
 * critical path. Only the `/progression` page needs it.
 */
let raidHistoryCache: { value: RaidClear[]; expiresAt: number } | null = null;
let raidHistoryInFlight: Promise<RaidClear[]> | null = null;

export async function getRaidHistory(): Promise<RaidClear[]> {
  if (raidHistoryCache && raidHistoryCache.expiresAt > Date.now()) {
    return raidHistoryCache.value;
  }
  if (raidHistoryInFlight) return raidHistoryInFlight;
  raidHistoryInFlight = (async () => {
    try {
      const [raidHistoryRaw, knownRaids] = await Promise.all([
        getGuildRaidHistory(GUILD.realm, GUILD.name),
        getKnownRaids(),
      ]);

      // Keep only achievements that match real raid names (filters out
      // dungeon "Guild Run" achievements). Then collapse to one entry per
      // raid by keeping the highest difficulty cleared, with that
      // difficulty's most recent timestamp. Stamp each entry with its
      // expansion so the UI can group.
      const byRaid = new Map<string, RaidClear>();
      const diffRank: Record<string, number> = {
        Normal: 0,
        Heroic: 1,
        Mythic: 2,
      };
      for (const clear of raidHistoryRaw) {
        const meta = knownRaids.get(clear.raidName);
        if (!meta) continue;
        // Sanity: drop attributions where the clear predates the raid's
        // release. RIO sometimes cross-lists old content (e.g. Blackrock
        // Depths under TWW Classic rotation). Allow a 30-day grace window
        // for clock skew / pre-release testing.
        if (
          meta.releasedAt > 0 &&
          clear.completedAt < meta.releasedAt - 30 * 24 * 60 * 60 * 1000
        ) {
          continue;
        }
        const stamped: RaidClear = {
          raidName: clear.raidName,
          difficulty: clear.difficulty,
          completedAt: clear.completedAt,
          raidSlug: meta.slug,
          expansionId: meta.expansionId,
          expansionName: meta.expansionName,
          iconUrl: meta.iconUrl,
        };
        const existing = byRaid.get(clear.raidName);
        if (!existing) {
          byRaid.set(clear.raidName, stamped);
        } else if (
          diffRank[clear.difficulty] > diffRank[existing.difficulty]
        ) {
          byRaid.set(clear.raidName, stamped);
        } else if (
          clear.difficulty === existing.difficulty &&
          clear.completedAt > existing.completedAt
        ) {
          byRaid.set(clear.raidName, stamped);
        }
      }
      const base = [...byRaid.values()].sort(
        (a, b) => b.completedAt - a.completedAt,
      );

      // Probe Mythic kills per encounter (BNet's "Guild Run" achievements
      // only cover N+H, so we need RIO boss-kill data for Mythic counts).
      // Heroic count is inferred from the achievement signal: a Heroic or
      // Mythic Guild Run means the raid was fully cleared on Heroic. For
      // pre-Legion raids RIO has no static-data, so we skip the probe and
      // just stamp totalBosses from a hardcoded fallback when known.
      const enriched = await Promise.all(
        base.map(async (clear) => {
          try {
            const isLegionPlus = !!clear.raidSlug;
            const meta = isLegionPlus
              ? await fetchRaidMeta(clear.raidSlug)
              : null;
            const totalBosses =
              meta?.encounters.length ??
              PRE_LEGION_RAIDS[clear.raidName]?.totalBosses;
            const mythicResults = meta
              ? await mapWithConcurrency(meta.encounters, 10, (e) =>
                  fetchBossKill(clear.raidSlug, e.slug, "Mythic"),
                )
              : [];
            const mythicKilled = mythicResults.filter((r) => !!r).length;
            const postDiff: RaidClear["difficulty"] =
              mythicKilled > 0 ? "Mythic" : clear.difficulty;
            const heroicKilled =
              postDiff === "Heroic" || postDiff === "Mythic"
                ? totalBosses
                : undefined;
            return {
              ...clear,
              mythicKilled: meta ? mythicKilled : undefined,
              heroicKilled,
              totalBosses,
              difficulty: postDiff,
            };
          } catch {
            return clear;
          }
        }),
      );

      raidHistoryCache = {
        value: enriched,
        expiresAt: Date.now() + 60 * 60 * 1000, // 1h
      };
      return enriched;
    } finally {
      raidHistoryInFlight = null;
    }
  })();
  return raidHistoryInFlight;
}

// ---- Current-tier boss kills, decoupled from snapshot critical path ----
// `fetchAllBossKills` is ~1 RIO call per killed boss × difficulty (~27 calls
// for a fully-cleared tier). Only `/progression` needs this. Pulling it out
// of the snapshot saves every other page from waiting on it.
let currentTierKillsCache: {
  tierSlug: string;
  value: Record<string, BossKill>;
  expiresAt: number;
} | null = null;
let currentTierKillsInFlight: Promise<Record<string, BossKill>> | null = null;

export async function getCurrentTierKills(): Promise<Record<string, BossKill>> {
  const snapshot = await getGuildSnapshot();
  const tierSlug = snapshot.tierSlug;
  if (!tierSlug) return {};

  if (
    currentTierKillsCache &&
    currentTierKillsCache.tierSlug === tierSlug &&
    currentTierKillsCache.expiresAt > Date.now()
  ) {
    return currentTierKillsCache.value;
  }
  if (currentTierKillsInFlight) return currentTierKillsInFlight;

  // Encounters and per-difficulty killed-slug sets are already in the
  // snapshot. Fall back to a prefix-slice of `killed` for old snapshots
  // that predate the per-boss probing (those won't have killedSlugs).
  const bosses = snapshot.tiers[0]?.bosses ?? [];
  const prefixSlugs = (count: number) =>
    bosses.slice(0, Math.max(0, Math.min(count, bosses.length))).map((b) => b.slug);
  const killedSlugsByDiff: Record<Difficulty, string[]> = {
    Mythic:
      snapshot.tiers.find((t) => t.difficulty === "Mythic")?.killedSlugs ??
      prefixSlugs(
        snapshot.tiers.find((t) => t.difficulty === "Mythic")?.killed ?? 0,
      ),
    Heroic:
      snapshot.tiers.find((t) => t.difficulty === "Heroic")?.killedSlugs ??
      prefixSlugs(
        snapshot.tiers.find((t) => t.difficulty === "Heroic")?.killed ?? 0,
      ),
    Normal:
      snapshot.tiers.find((t) => t.difficulty === "Normal")?.killedSlugs ??
      prefixSlugs(
        snapshot.tiers.find((t) => t.difficulty === "Normal")?.killed ?? 0,
      ),
  };

  currentTierKillsInFlight = (async () => {
    try {
      const kills = await fetchAllBossKills(tierSlug, bosses, killedSlugsByDiff);
      currentTierKillsCache = {
        tierSlug,
        value: kills,
        expiresAt: Date.now() + 60 * 60 * 1000, // 1h
      };
      return kills;
    } finally {
      currentTierKillsInFlight = null;
    }
  })();
  return currentTierKillsInFlight;
}

/** Threshold below which we treat a fresh snapshot as "suspiciously
 *  partial" — RIO's bulk member endpoint sometimes 200s with random
 *  characters dropped. The bundled snapshot (from the last successful
 *  cron commit, baked into the deploy) is preferred over a partial fresh
 *  response when it's bigger. */
const HEALTHY_ROSTER_MIN = 25;

async function readFallbackSnapshot(): Promise<GuildSnapshot> {
  // Use the bundled snapshot directly. The previous raw.githubusercontent.com
  // fetch silently 404'd because the repo is private, which meant the merge
  // below never backfilled missing names — so a single flaky RIO response
  // could drop the cron's roster count below the regression threshold and
  // block the commit. The bundled JSON has the last-known-good roster baked
  // in at build time, no network needed.
  return bundledSnapshot;
}

/**
 * Bundled snapshot + enrichments served from `data/snapshot.json` (committed
 * hourly by the GH Action via `/api/snapshot-export`). This is the *fast
 * path* used by every page render — zero network, zero RIO/BNet latency,
 * freshness ≈ last commit (≤1h).
 *
 * Routes that genuinely need a live RIO/BNet refresh (the cron that
 * *generates* the JSON, the manual /api/refresh warmup) call
 * `getGuildSnapshotLive()` / `getRosterEnrichmentsLive()` directly.
 */
const bundledFile = bundledSnapshotFile as unknown as {
  snapshot: GuildSnapshot;
  enrichedRoster: Character[];
  recentAchievements: GuildAchievement[];
};
// The bundled JSON is committed by the hourly cron via /api/snapshot-export
// — older commits predate the `isOfficer` field, so we stamp it on read.
// (The live build stamps it directly during construction.) Once the cron
// re-runs and commits a fresh JSON, the field will already be present and
// this re-stamp is a harmless no-op. Both the snapshot roster and the
// separately-bundled enrichedRoster need stamping — the roster page reads
// enrichedRoster, the about page reads snapshot.roster. We exclude all
// characters in GUILD_LEADER_CHARACTERS (not just the isGuildLeader-flagged
// main) so a leader's parked alt at rank 0 doesn't grab an Officer badge.
const leaderCharNamesLc = new Set(
  GUILD_LEADER_CHARACTERS.map((n) => n.toLowerCase()),
);
const stampOfficer = (c: Character): Character => {
  // Old committed snapshots can contain mojibake-encoded names (RIO has
  // returned double-encoded UTF-8 for some characters in the past). Fix on
  // read so the merge in getGuildSnapshotLive dedupes against fresh data
  // and the UI never displays the corrupted form.
  const name = fixMojibake(c.name);
  return {
    ...c,
    name,
    isOfficer:
      !c.isGuildLeader &&
      !leaderCharNamesLc.has(name.toLowerCase()) &&
      c.rankNumber <= OFFICER_RANK_THRESHOLD,
  };
};

function fixRunnerName<T extends { name: string }>(r: T): T {
  return { ...r, name: fixMojibake(r.name) };
}
function fixRunNames(run: GuildRun): GuildRun {
  return { ...run, runners: run.runners.map(fixRunnerName) };
}
const bundledSnapshot: GuildSnapshot = {
  ...bundledFile.snapshot,
  roster: bundledFile.snapshot.roster.map(stampOfficer),
  recentRuns: (bundledFile.snapshot.recentRuns ?? []).map(fixRunNames),
  weeklyTopRuns: (bundledFile.snapshot.weeklyTopRuns ?? []).map(fixRunNames),
  // Older committed snapshots predate weeklyTopByCharacter — derive it from
  // the flat weeklyTopRuns list on read so the UI still renders. Result is
  // narrower than a live build (which sees all per-character runs, not just
  // the global top-N), but it's a graceful bridge until the next cron commit.
  weeklyTopByCharacter: (
    bundledFile.snapshot.weeklyTopByCharacter ??
    deriveWeeklyTopByCharacter(bundledFile.snapshot.weeklyTopRuns ?? [])
  ).map((c) => ({
    ...c,
    runner: fixRunnerName(c.runner),
    runs: c.runs.map(fixRunNames),
  })),
  previousWeekTopByCharacter: (
    bundledFile.snapshot.previousWeekTopByCharacter ?? []
  ).map((c) => ({
    ...c,
    runner: fixRunnerName(c.runner),
    runs: c.runs.map(fixRunNames),
  })),
  resilient: (bundledFile.snapshot.resilient ?? []).map((r) => ({
    ...r,
    runner: fixRunnerName(r.runner),
  })),
  // Apply SEASON_TITLE_OVERRIDES on read so a manual grant (e.g. honoring the
  // first holder) shows from the committed snapshot without waiting for the
  // next cron rebuild.
  seasonTitles: applySeasonTitleOverrides(
    (bundledFile.snapshot.seasonTitles ?? []).map((t) => ({
      ...t,
      runner: fixRunnerName(t.runner),
    })),
    bundledFile.snapshot.roster.map(stampOfficer),
  ),
  rioCharacterIds: bundledFile.snapshot.rioCharacterIds ?? {},
};

function deriveWeeklyTopByCharacter(
  weeklyRuns: GuildRun[],
): CharacterWeeklyKeys[] {
  const buckets = new Map<
    string,
    { runner: GuildRunner; runs: GuildRun[] }
  >();
  for (const run of weeklyRuns) {
    for (const runner of run.runners) {
      const key = `${runner.realmSlug}:${runner.name.toLowerCase()}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { runner, runs: [] };
        buckets.set(key, bucket);
      }
      bucket.runs.push(run);
    }
  }
  return [...buckets.values()]
    .map(({ runner, runs }) => {
      const sorted = runs
        .slice()
        .sort((a, b) => b.score - a.score || b.level - a.level);
      return { runner, runs: sorted.slice(0, 3), topScore: sorted[0]?.score ?? 0 };
    })
    .sort((a, b) => b.topScore - a.topScore)
    .slice(0, 12);
}
// claimedOwner lives in both the hourly snapshot.roster and the twice-daily
// enrichedRoster. Top Performers reads enrichedRoster, so without this it would
// only pick up a newly-resolved warband owner at the next enrichments run (up to
// 12h). Overlay the fresher snapshot.roster value so alt grouping updates within
// the hour.
const snapshotRosterByKey = new Map(
  bundledSnapshot.roster.map((c) => [
    `${c.realmSlug.toLowerCase()}:${c.name.toLowerCase()}`,
    c,
  ]),
);
const bundledEnrichments: RosterEnrichments = {
  enrichedRoster: bundledFile.enrichedRoster.map(stampOfficer).map((c) => {
    const fresh = snapshotRosterByKey.get(
      `${c.realmSlug.toLowerCase()}:${c.name.toLowerCase()}`,
    );
    return {
      ...c,
      seasonTitles: applyCharacterSeasonTitleOverrides(c.name, c.seasonTitles ?? []),
      claimedOwner: fresh?.claimedOwner ?? c.claimedOwner,
    };
  }),
  recentAchievements: bundledFile.recentAchievements.map((a) => ({
    ...a,
    character: fixRunnerName(a.character),
  })),
};

/**
 * Resolve a character's collectible season-title row, applying
 * SEASON_TITLE_OVERRIDES. Used for the per-character roster + character-page
 * badge.
 *   - no override → the titles detected from BNet
 *   - `hide`      → suppress all titles
 *   - `grant`     → merge granted title(s) in, but detection wins per-season
 *                   (a manual placeholder yields to the real achievement)
 * Returns newest-first.
 */
function applyCharacterSeasonTitleOverrides(
  name: string,
  detected: CharacterSeasonTitle[],
): CharacterSeasonTitle[] {
  const o = SEASON_TITLE_OVERRIDES[name];
  if (!o) return detected;
  if (o.hide) return [];
  const grants = (Array.isArray(o.grant) ? o.grant : [o.grant]).map((g) => ({
    title: g.title,
    name: g.name,
    season: g.season,
    earnedAt: g.earnedAt,
    tier: g.tier,
  }));
  const bySeason = new Map<string, CharacterSeasonTitle>();
  for (const d of detected) bySeason.set(d.season, d);
  for (const g of grants) if (!bySeason.has(g.season)) bySeason.set(g.season, g);
  return [...bySeason.values()].sort((a, b) => b.earnedAt - a.earnedAt);
}

/**
 * Merge SEASON_TITLE_OVERRIDES into a list of detected title awards. Pure +
 * synchronous so both the live snapshot build and the bundled read path share
 * one rule set: `hide` removes a holder; `grant` injects one only when
 * detection hasn't already found the real achievement (detection wins). Runner
 * details for a granted holder are pulled from the roster when present.
 */
function applySeasonTitleOverrides(
  detected: SeasonTitleAward[],
  roster: Pick<
    Character,
    "name" | "realmSlug" | "class" | "mythicPlusScore"
  >[],
): SeasonTitleAward[] {
  const byName = new Map(roster.map((c) => [c.name, c]));
  const awards = new Map<string, SeasonTitleAward>();
  for (const a of detected) awards.set(a.runner.name, a);

  for (const [name, o] of Object.entries(SEASON_TITLE_OVERRIDES)) {
    if (o.hide) {
      awards.delete(name);
      continue;
    }
    if (awards.has(name)) continue;
    const c = byName.get(name);
    // A holder's "current" award is their newest granted title.
    const grants = Array.isArray(o.grant) ? o.grant : [o.grant];
    const g = [...grants].sort((a, b) => b.earnedAt - a.earnedAt)[0];
    awards.set(name, {
      runner: {
        name: c?.name ?? name,
        realmSlug: c?.realmSlug ?? GUILD.realm,
        class: c?.class ?? "warrior",
      },
      title: g.title,
      name: g.name,
      season: g.season,
      achievementName: `${g.name}: ${g.season}`,
      earnedAt: g.earnedAt,
      score: c?.mythicPlusScore ?? 0,
      tier: g.tier,
      manual: true,
    });
  }

  return [...awards.values()].sort((a, b) => b.score - a.score);
}

/**
 * Build the snapshot's current Mythic+ end-of-season accolade holders — both
 * the top-0.1% "Hero" title and the top-1% "Champion" achievement (the badge
 * carries `tier` so the UI colors them gold vs silver). Scans only the top
 * SEASON_TITLE_SCAN_LIMIT roster characters by M+ score: even the wider top-1%
 * band sits well above any low scorer, and a guild's realistic holder count
 * fits comfortably under the limit — which keeps the snapshot build's BNet load
 * bounded and timeout-safe. (If a member ranked below the limit ever earns
 * Champion, raise SEASON_TITLE_SCAN_LIMIT.) Authoritative source is the BNet
 * achievement (via getCharacterTierData, memoized 24h); SEASON_TITLE_OVERRIDES
 * can grant or hide.
 */
async function computeSeasonTitles(
  roster: Character[],
  priorTitles: SeasonTitleAward[],
  priorRoster: Character[],
): Promise<SeasonTitleAward[]> {
  const candidates = [...roster]
    .filter((c) => (c.mythicPlusScore ?? 0) > 0)
    .sort((a, b) => (b.mythicPlusScore ?? 0) - (a.mythicPlusScore ?? 0))
    .slice(0, SEASON_TITLE_SCAN_LIMIT);

  // Incremental gate. A Mythic+ Hero title is earned through M+, so it can't
  // change unless the character ran a new key — and each scan fetches the
  // ~2.67MB BNet achievements blob. So we only re-scan candidates whose
  // lastRunAt changed since the prior snapshot; idle candidates reuse their
  // prior award. A title-less idle candidate stays title-less: score only
  // moves with keys, so they were a candidate (and already scanned) last cycle.
  const keyOf = (rs: string, n: string) => `${rs}:${n}`.toLowerCase();
  const priorLastRunAt = new Map<string, number>();
  for (const c of priorRoster) {
    priorLastRunAt.set(keyOf(c.realmSlug, c.name), c.lastRunAt ?? 0);
  }
  const priorAwardByKey = new Map<string, SeasonTitleAward>();
  for (const a of priorTitles) {
    priorAwardByKey.set(keyOf(a.runner.realmSlug, a.runner.name), a);
  }

  const toScan: Character[] = [];
  const reused: SeasonTitleAward[] = [];
  for (const c of candidates) {
    const k = keyOf(c.realmSlug, c.name);
    const prior = priorLastRunAt.get(k);
    const changed = prior === undefined || (c.lastRunAt ?? 0) !== prior;
    if (changed) {
      toScan.push(c);
      continue;
    }
    const pa = priorAwardByKey.get(k);
    if (pa) reused.push(pa);
  }
  console.log(
    `[seasonTitles] ${toScan.length}/${candidates.length} scanned (achievements parsed); ${reused.length} reused`,
  );

  const scanned = await mapWithConcurrency(
    toScan,
    ENRICHMENT_CONCURRENCY,
    async (c) => {
      try {
        const td = await getCharacterTierData(
          c.realmSlug,
          c.name,
          CURRENT_TIER_FINAL_BOSS,
        );
        // The award reflects the holder's newest (current) title.
        return td?.seasonTitles?.[0] ?? null;
      } catch (err) {
        console.error("[seasonTitles] scan failed for", c.name, err);
        return null;
      }
    },
  );

  const detected: SeasonTitleAward[] = [...reused];
  toScan.forEach((c, i) => {
    const t = scanned[i];
    if (!t) return;
    detected.push({
      runner: { name: c.name, realmSlug: c.realmSlug, class: c.class },
      title: t.title,
      name: t.name,
      season: t.season,
      achievementName: `${t.name}: ${t.season}`,
      earnedAt: t.earnedAt,
      score: c.mythicPlusScore ?? 0,
      tier: t.tier,
    });
  });

  // Restore the by-score ordering the candidate loop produced (reused +
  // scanned are interleaved above).
  detected.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return applySeasonTitleOverrides(detected, roster);
}

export async function getGuildSnapshot(): Promise<GuildSnapshot> {
  return bundledSnapshot;
}

export async function getGuildSnapshotLive(): Promise<GuildSnapshot> {
  if (snapshotCache && snapshotCache.expiresAt > Date.now()) {
    return snapshotCache.value;
  }
  if (snapshotInFlight) return snapshotInFlight;
  snapshotInFlight = (async () => {
    try {
      const snapshot = await _getGuildSnapshot();
      const fallback = await readFallbackSnapshot();

      // Every member in the fresh live response was seen in RIO's guild roster
      // right now — stamp them so the departure grace window has a current
      // anchor. Backfilled members (below) deliberately keep their older value.
      const seenNow = Date.now();
      for (const c of snapshot.roster) c.lastSeenAt = seenNow;

      // Catastrophic case: live snapshot is well below threshold AND the
      // fallback is meaningfully more complete. Use the fallback whole.
      if (
        snapshot.roster.length < HEALTHY_ROSTER_MIN &&
        fallback &&
        fallback.roster.length > snapshot.roster.length
      ) {
        console.warn(
          `[raiderio] fresh snapshot only ${snapshot.roster.length} members; using fallback (${fallback.roster.length})`,
        );
        snapshotCache = {
          value: fallback,
          expiresAt: Date.now() + 60 * 60 * 1000,
        };
        return fallback;
      }

      // Common case: live snapshot is mostly complete but RIO dropped a
      // few names. Merge in any roster entries from the fallback that
      // aren't in the live response — keeps tier prog / weekly runs etc.
      // from the live snapshot but backfills missing characters using
      // their last-known-good data (max ~1h stale). Without this, a
      // single flaky RIO response silently loses 3-5 raiders for an hour.
      if (fallback && fallback.roster.length > 0) {
        const liveNamesLc = new Set(
          snapshot.roster.map((c) => c.name.toLowerCase()),
        );
        // Backfill candidates: present in the saved snapshot, absent from this
        // live response. Two guards:
        //   1. avatarUrl — real RIO/BNet-enriched entries always have one;
        //      entries without are leftover mock/test data we don't resurrect.
        //   2. departure grace — only backfill members seen live within the
        //      last DEPARTURE_GRACE_HOURS. A member absent beyond that has
        //      almost certainly LEFT the guild (vs a one-off RIO drop), so we
        //      stop resurrecting them and they quietly fall off the roster.
        //      Backfilled members keep their existing lastSeenAt so it keeps
        //      ageing across builds; first-seen-as-missing (legacy snapshots
        //      with no lastSeenAt) get the clock started now.
        const graceMs = DEPARTURE_GRACE_HOURS * 60 * 60 * 1000;
        const departed: string[] = [];
        const missing = fallback.roster
          .filter((c) => !liveNamesLc.has(c.name.toLowerCase()) && Boolean(c.avatarUrl))
          .map((c) => ({ c, lastSeenAt: c.lastSeenAt ?? seenNow }))
          .filter(({ c, lastSeenAt }) => {
            if (seenNow - lastSeenAt < graceMs) return true;
            departed.push(c.name);
            return false;
          })
          // Persist a concrete lastSeenAt (frozen — NOT refreshed to now) so a
          // genuinely-absent member ages toward the grace cutoff each build.
          .map(({ c, lastSeenAt }) => ({ ...c, lastSeenAt }));
        if (departed.length > 0) {
          console.warn(
            `[raiderio] dropping ${departed.length} member(s) absent > ${DEPARTURE_GRACE_HOURS}h (treated as departed):`,
            departed,
          );
        }
        if (missing.length > 0) {
          console.warn(
            `[raiderio] backfilling ${missing.length} missing members from fallback:`,
            missing.map((c) => c.name),
          );
          snapshot.roster = [...snapshot.roster, ...missing];

          // Backfilled characters were never enrichRoster'd this pass, so
          // their runs aren't in the live recentRuns / weeklyTopRuns. For
          // any run URL that exists in both live and fallback, splice the
          // backfilled character back in as a runner so the run feed still
          // shows them on group keys they participated in. Doesn't add new
          // runs — only patches attribution on runs already in the live
          // top-12.
          const missingNamesLc = new Set(
            missing.map((c) => c.name.toLowerCase()),
          );
          const patchRunners = (
            liveRuns: GuildRun[],
            fallbackRuns: GuildRun[],
          ): void => {
            const byUrl = new Map(liveRuns.map((r) => [r.url, r]));
            for (const fb of fallbackRuns) {
              const live = byUrl.get(fb.url);
              if (!live) continue;
              for (const runner of fb.runners) {
                if (!missingNamesLc.has(runner.name.toLowerCase())) continue;
                if (live.runners.some((r) => r.name === runner.name)) continue;
                live.runners.push(runner);
              }
            }
          };
          patchRunners(snapshot.recentRuns, fallback.recentRuns);
          patchRunners(snapshot.weeklyTopRuns, fallback.weeklyTopRuns);
          if (
            snapshot.weeklyTopByCharacter &&
            fallback.weeklyTopByCharacter
          ) {
            for (const fb of fallback.weeklyTopByCharacter) {
              if (!missingNamesLc.has(fb.runner.name.toLowerCase())) continue;
              const already = snapshot.weeklyTopByCharacter.some(
                (e) =>
                  e.runner.name.toLowerCase() === fb.runner.name.toLowerCase(),
              );
              if (!already) snapshot.weeklyTopByCharacter.push(fb);
            }
            snapshot.weeklyTopByCharacter.sort(
              (a, b) => b.topScore - a.topScore,
            );
            snapshot.weeklyTopByCharacter = snapshot.weeklyTopByCharacter.slice(
              0,
              12,
            );
          }

          // Resilient is computed over the LIVE roster only, so a member RIO
          // dropped from this fetch (backfilled into the roster above) would
          // otherwise lose their Resilient tier. Carry their prior entry
          // forward too, mirroring the roster backfill.
          if (fallback.resilient?.length) {
            const cur = snapshot.resilient ?? (snapshot.resilient = []);
            const have = new Set(cur.map((r) => r.runner.name.toLowerCase()));
            for (const r of fallback.resilient) {
              const n = r.runner.name.toLowerCase();
              if (missingNamesLc.has(n) && !have.has(n)) cur.push(r);
            }
            cur.sort(
              (a, b) =>
                new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime(),
            );
          }

          // Season titles are scanned over the live roster too — carry forward
          // a backfilled member's award the same way (also guards against the
          // incremental scan skipping a member RIO dropped this fetch).
          if (fallback.seasonTitles?.length) {
            const cur = snapshot.seasonTitles ?? (snapshot.seasonTitles = []);
            const have = new Set(cur.map((a) => a.runner.name.toLowerCase()));
            for (const a of fallback.seasonTitles) {
              const n = a.runner.name.toLowerCase();
              if (missingNamesLc.has(n) && !have.has(n)) cur.push(a);
            }
            cur.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
          }
        }
      }

      snapshotCache = {
        value: snapshot,
        expiresAt: Date.now() + 60 * 60 * 1000, // 1h
      };
      return snapshot;
    } finally {
      snapshotInFlight = null;
    }
  })();
  return snapshotInFlight;
}


async function _getGuildSnapshot(): Promise<GuildSnapshot> {
  try {
    const [guild, affixes] = await Promise.all([
      fetchGuild(),
      fetchAffixes(),
    ]);
    const tierSlug = pickCurrentTierSlug(guild);
    if (!tierSlug) {
      return await readFallbackSnapshot();
    }

    const raidMeta = await fetchRaidMeta(tierSlug);
    const progression = guild.raid_progression?.[tierSlug];
    const rankings = guild.raid_rankings?.[tierSlug];
    if (!progression || !raidMeta) {
      return await readFallbackSnapshot();
    }

    const displayName =
      RAID_NAME_OVERRIDES[tierSlug] ?? raidMeta.name ?? tierSlug;

    // Resolve boss portraits + raid metadata in parallel with roster
    // enrichment so the fan-out doesn't extend snapshot latency. Both lookups
    // are heavily cached.
    //
    // Boss icons: try the parent tier name first (works when BNet has a
    // journal entry for the raid by that name). Multi-raid tiers (Midnight)
    // require resolving per sub-raid name — handled below.
    const subRaidConfigs = TIER_SUB_RAIDS[tierSlug] ?? [];
    const baseRoster = shapeRoster(guild.members);
    const [enriched, parentBossIcons, knownRaids, subRaidArt] =
      await Promise.all([
        enrichRoster(baseRoster),
        resolveRaidBossIcons(raidMeta.name).catch(
          () => new Map<string, string>(),
        ),
        getKnownRaids().catch(() => new Map<string, RaidMeta>()),
        Promise.all(
          subRaidConfigs.map(async (sr) => {
            const [tileUrl, icons] = await Promise.all([
              getRaidTileUrlByName(sr.bnetName).catch(() => null),
              resolveRaidBossIcons(sr.bnetName).catch(
                () => new Map<string, string>(),
              ),
            ]);
            return { config: sr, tileUrl, icons };
          }),
        ),
      ]);
    const tierMeta = knownRaids.get(raidMeta.name);
    // Merge per-sub-raid boss icons into a single lookup so the flat
    // tier.bosses still gets icons populated.
    const bossIcons = new Map(parentBossIcons);
    for (const sr of subRaidArt) {
      for (const [k, v] of sr.icons) bossIcons.set(k, v);
    }

    // RIO's `*_bosses_killed` is only a count, but guilds frequently kill
    // bosses out of order (e.g. skipping a stuck encounter to make progress
    // on a later boss). Probing /guilds/boss-kill per-boss-per-difficulty
    // gives us the actual set of killed slugs — without this, the UI marks
    // the wrong bosses defeated when guild order differs from RIO's
    // encounter ordering.
    const countsByDiff: Record<Difficulty, number> = {
      Mythic: progression.mythic_bosses_killed,
      Heroic: progression.heroic_bosses_killed,
      Normal: progression.normal_bosses_killed,
    };
    const probedSlugsByDiff = await probeKilledSlugsByDifficulty(
      tierSlug,
      raidMeta.encounters,
      countsByDiff,
    );

    const tiers: TierState[] = (
      ["Mythic", "Heroic", "Normal"] as const
    ).map((difficulty) => {
      const rioCount = countsByDiff[difficulty];
      const probed = probedSlugsByDiff[difficulty];
      // Probe-failure fallback: if probing returned fewer slugs than RIO's
      // count (rate-limit, transient 5xx, etc.), don't stamp killedSlugs at
      // all — that way the page renders via the prefix-slice fallback and
      // we don't *lose* progression display just because probes flaked.
      // Probing fully succeeded only when probed.length === rioCount.
      const probeOK = probed.length === rioCount;
      const killedSlugs = probeOK ? probed : undefined;
      const killedSet = killedSlugs ? new Set(killedSlugs) : null;
      const killed = rioCount;
      const bosses: Boss[] = raidMeta.encounters.map((e) => ({
        name: e.name,
        slug: e.slug,
        iconUrl: bossIcons.get(normalizeBossNameKey(e.name)),
      }));
      // Sub-raid grouping: split the flat boss list per config. Each sub-raid
      // owns the killedSlugs intersected with its bosses when probing
      // succeeded; otherwise fall back to the legacy prefix-slice convention
      // (the parent tier's `killed` count consumed left-to-right).
      let subRaids: SubRaid[] | undefined;
      if (subRaidConfigs.length) {
        let cursor = 0;
        subRaids = subRaidArt.map((sr) => {
          const slice = bosses.slice(cursor, cursor + sr.config.bossSlugs.length);
          const localOffset = cursor;
          cursor += sr.config.bossSlugs.length;
          if (killedSet) {
            const subKilledSlugs = slice
              .map((b) => b.slug)
              .filter((s) => killedSet.has(s));
            return {
              name: sr.config.name,
              iconUrl: sr.tileUrl ?? undefined,
              bosses: slice,
              killed: subKilledSlugs.length,
              killedSlugs: subKilledSlugs,
            };
          }
          // Prefix-slice fallback per the legacy shape so the UI still
          // renders something sensible when probes failed.
          const subKilled = Math.max(
            0,
            Math.min(rioCount - localOffset, sr.config.bossSlugs.length),
          );
          return {
            name: sr.config.name,
            iconUrl: sr.tileUrl ?? undefined,
            bosses: slice,
            killed: subKilled,
          };
        });
      }
      return {
        raidName: displayName,
        totalBosses: progression.total_bosses,
        difficulty,
        killed,
        killedSlugs,
        bosses,
        subRaids,
      };
    });

    const guildRankings: GuildRanking[] = rankings
      ? (["Mythic", "Heroic", "Normal"] as const).map((d) => ({
          difficulty: d,
          ...rankings[d.toLowerCase() as "mythic" | "heroic" | "normal"],
        }))
      : [];

    // Build the "raids with the guild" set by unioning every guild-credited
    // boss-kill roster for the active tier. `tierKillsTotal>0` would catch
    // current-tier kills from any source (pugs, alt groups, etc.) — this is
    // stricter: only characters RIO recorded as participants in a guild
    // kill. Re-fetches per (boss × diff), but probeKilledSlugsByDifficulty
    // above already warmed the Next fetch cache for the same URLs (6h TTL
    // via REVALIDATE.bossKill), so this is effectively a cache walk.
    const killedSlugsForKillFetch: Record<Difficulty, string[]> = {
      Mythic: tiers.find((t) => t.difficulty === "Mythic")?.killedSlugs ?? [],
      Heroic: tiers.find((t) => t.difficulty === "Heroic")?.killedSlugs ?? [],
      Normal: tiers.find((t) => t.difficulty === "Normal")?.killedSlugs ?? [],
    };
    const tierKillRosters = await fetchAllBossKills(
      tierSlug,
      raidMeta.encounters,
      killedSlugsForKillFetch,
    ).catch(() => ({} as Record<string, BossKill>));
    const guildRaiderKeys = new Set<string>();
    for (const k of Object.values(tierKillRosters)) {
      for (const p of k.roster) {
        guildRaiderKeys.add(`${p.realmSlug}:${p.name.toLowerCase()}`);
      }
    }

    const guildHardest = hardestGuildDifficulty(progression);
    const minDiff = resolveMinDifficulty(guildHardest);
    const guildKillsAtHardest =
      guildHardest === "Mythic"
        ? progression.mythic_bosses_killed
        : guildHardest === "Heroic"
        ? progression.heroic_bosses_killed
        : guildHardest === "Normal"
        ? progression.normal_bosses_killed
        : 0;
    // ROSTER_PINS is the source of truth for "characters that must always
    // appear on the roster regardless of what RIO returns." Two failure
    // modes we've seen:
    //   1. Pinned name missing from the bulk member response entirely
    //      (RIO sometimes 200s with a partial list — retries can't catch
    //      that since the response is "successful").
    //   2. Pinned name present in the bulk list but their individual
    //      profile fetch failed at enrichment time, leaving stub data
    //      (no avatar, no M+ score, all-zero roleScores).
    //
    // Always force-fetch pinned characters by name and merge in. If they
    // already exist in `enriched` with valid data, the merge keeps the
    // better record; if they exist as a stub, the fresh fetch replaces
    // it. Cost: ROSTER_PINS.length extra RIO calls, each cached by
    // Next.js, so warm-cache hits cost nothing.
    const pinnedRecovered = await Promise.all(
      ROSTER_PINS.map((p) => fetchLeaderAsEnriched(p.name, p.realm)),
    );
    for (const fresh of pinnedRecovered) {
      if (!fresh) continue;
      const existingIdx = enriched.findIndex(
        (e) =>
          e.character.name.toLowerCase() ===
          fresh.character.name.toLowerCase(),
      );
      if (existingIdx >= 0) {
        // Stub detection: if the existing record has no avatar AND
        // all-zero roleScores, the original profile fetch failed and
        // we should swap in the fresh data. Otherwise keep the original
        // (it has the correct rank/rankLabel from the guild member list).
        const existing = enriched[existingIdx].character;
        const isStub =
          !existing.avatarUrl &&
          existing.roleScores.tank === 0 &&
          existing.roleScores.healer === 0 &&
          existing.roleScores.dps === 0;
        if (isStub) {
          enriched[existingIdx] = {
            ...fresh,
            character: {
              ...fresh.character,
              // Preserve rank/rankLabel from the original bulk record.
              rank: existing.rank,
              rankNumber: existing.rankNumber,
              rankLabel: existing.rankLabel,
            },
            rank: enriched[existingIdx].rank,
          };
        }
      } else {
        enriched.push(fresh);
      }
    }
    // Stamp role overrides from ROSTER_PINS onto every matching enriched
    // character. Forces TopPerformers + roster to bucket them by their
    // actual primary role rather than whatever M+ score split RIO
    // currently reports (e.g. a Prot Paladin PUGing Ret keys higher than
    // their tank keys would otherwise misclass as DPS). Stored as a
    // separate roleOverride field so the score-based bucketing still
    // applies to non-pinned characters.
    const roleOverrides = new Map<string, "tank" | "healer" | "dps">();
    const specOverrides = new Map<string, string>();
    for (const p of ROSTER_PINS) {
      if (p.role) roleOverrides.set(p.name.toLowerCase(), p.role);
      if (p.spec) specOverrides.set(p.name.toLowerCase(), p.spec);
    }
    for (const e of enriched) {
      const nameLc = e.character.name.toLowerCase();
      const roleOverride = roleOverrides.get(nameLc);
      if (roleOverride) e.character.roleOverride = roleOverride;
      const specOverride = specOverrides.get(nameLc);
      if (specOverride) e.character.spec = specOverride;
    }
    const leaderPins = new Set<string>();
    for (const group of GUILD_LEADER_GROUPS) {
      const canonicalName = group[0];
      if (!canonicalName) continue;
      const inEnriched = enriched.some(
        (e) => e.character.name.toLowerCase() === canonicalName.toLowerCase(),
      );
      if (inEnriched) leaderPins.add(canonicalName.toLowerCase());
    }

    const activeEnriched = enriched.filter(
      ({ kills, character, rank, lastRunAt }) => {
        if (leaderPins.has(character.name.toLowerCase())) return true;
        return passesActivityFilter({
          kills,
          character,
          rank,
          minDiff,
          guildKillsAtHardest,
          lastRunAt,
        });
      },
    );
    // Stamp each active character with their most-recent M+ run timestamp
    // so the roster can surface "active this week" raiders. Also stamp the
    // leader-pin flag so RosterGrid can render the "Guild Leader" badge
    // without re-running the group resolution on the client.
    // Build a per-character lookup from the previously bundled snapshot so
    // we can detect new activity (a new key or boss kill since last
    // snapshot) and carry the all-time peak forward. Key by realm+nameLc.
    type PrevEntry = {
      peakIlvl?: number;
      peakIlvlAt?: number;
      lastKeyIlvl?: number;
      lastKeyAt?: number;
      lastRaidIlvl?: number;
      lastRaidAt?: number;
      tierKillsTotal?: number;
    };
    const prevLookup = new Map<string, PrevEntry>();
    for (const prev of bundledFile.snapshot.roster) {
      const key = `${prev.realmSlug}:${prev.name.toLowerCase()}`;
      prevLookup.set(key, {
        peakIlvl: typeof prev.peakIlvl === "number" ? prev.peakIlvl : undefined,
        peakIlvlAt: prev.peakIlvlAt,
        lastKeyIlvl:
          typeof prev.lastKeyIlvl === "number" ? prev.lastKeyIlvl : undefined,
        lastKeyAt: prev.lastKeyAt,
        lastRaidIlvl:
          typeof prev.lastRaidIlvl === "number" ? prev.lastRaidIlvl : undefined,
        lastRaidAt: prev.lastRaidAt,
        tierKillsTotal: prev.tierKillsTotal,
      });
    }
    const now = Date.now();

    // lastKey enrichment: for any character whose lastRunAt has advanced
    // vs the prior snapshot, fan out a run-details fetch to pull their
    // exact per-run ilvl. Bounded by ENRICHMENT_CONCURRENCY since each
    // fetch downloads ~1MB. Result keyed by realmSlug:nameLc.
    const newKeyActivity = activeEnriched.filter(({ character, lastRunAt }) => {
      if (lastRunAt <= 0) return false;
      const prev = prevLookup.get(
        `${character.realmSlug}:${character.name.toLowerCase()}`,
      );
      // First observation for this character (no prior entry) OR their
      // most recent key is newer than the one we already sampled.
      return !prev?.lastKeyAt || lastRunAt > prev.lastKeyAt;
    });
    const lastKeyResults = await mapWithConcurrency(
      newKeyActivity,
      ENRICHMENT_CONCURRENCY,
      async (e) => {
        const result = await fetchLastKeyIlvl(
          e.recentRuns.map((r) => ({
            url: r.url,
            keystone_run_id: extractKeystoneRunId(r.url),
            completed_at: r.completedAt,
          })),
          e.character.realmSlug,
          e.character.name,
        );
        return {
          key: `${e.character.realmSlug}:${e.character.name.toLowerCase()}`,
          result,
        };
      },
    );
    const lastKeyByChar = new Map<
      string,
      { ilvl: number; at: number } | null
    >();
    for (const r of lastKeyResults) lastKeyByChar.set(r.key, r.result);

    // lastRaid enrichment: fan out BNet `/encounters/raids` per active
    // character and stash the max `last_kill_timestamp` across the current
    // tier's sub-raid instances. The guild-level RIO endpoint is first-kill
    // only, so farm re-kills there leave both the guild's and the
    // character's `tierKillsTotal` flat — invisible to the old logic.
    // BNet per-encounter timestamps update on every kill, so this catches
    // farm nights. ~1 BNet call per active character, and `getCharacterLastRaidKill`
    // passes `skipNextCache: true` — so unlike the other per-char fanouts this is a
    // FRESH fetch + parse every hour (no Next.js cache), by design: a cached
    // response captured before tonight's kill would miss the very detection this
    // exists for. It's the one un-gated per-char fanout for that reason (the fetch
    // IS the freshness signal — no cheaper signal reveals a farm re-kill). If the
    // route table ever shows this is material, the only lever is a freshness
    // tradeoff (run it less than hourly), not incrementality.
    const tierInstanceNames = new Set<string>();
    const subRaidsForTier = TIER_SUB_RAIDS[tierSlug];
    if (subRaidsForTier && subRaidsForTier.length) {
      for (const sr of subRaidsForTier) tierInstanceNames.add(sr.bnetName);
    } else if (raidMeta?.name) {
      tierInstanceNames.add(raidMeta.name);
    }
    const lastRaidResults = await mapWithConcurrency(
      activeEnriched,
      ENRICHMENT_CONCURRENCY,
      async (e) => {
        const ts = await getCharacterLastRaidKill(
          e.character.realmSlug,
          e.character.name,
          tierInstanceNames,
        ).catch(() => 0);
        return {
          key: `${e.character.realmSlug}:${e.character.name.toLowerCase()}`,
          ts,
        };
      },
    );
    const lastRaidKillByChar = new Map<string, number>();
    for (const r of lastRaidResults) lastRaidKillByChar.set(r.key, r.ts);

    const active = activeEnriched.map(({ character, lastRunAt, kills }) => {
      const nameLc = character.name.toLowerCase();
      const isLeader = leaderPins.has(nameLc);
      const currentIlvl = character.ilvl;
      const lookupKey = `${character.realmSlug}:${nameLc}`;
      const prev = prevLookup.get(lookupKey);
      const tierKillsTotal =
        (kills?.normal ?? 0) + (kills?.heroic ?? 0) + (kills?.mythic ?? 0);
      // Heroic + Mythic only — what the Top Raiders board ranks on (matches
      // the character sheet's H/M tier-progress counts).
      const tierKillsHM = (kills?.heroic ?? 0) + (kills?.mythic ?? 0);

      // All-time peak: carry forward, advance only when current strictly
      // beats prior peak. Same semantics as before.
      let peakIlvl: number | undefined;
      let peakIlvlAt: number | undefined;
      if (currentIlvl == null) {
        peakIlvl = prev?.peakIlvl;
        peakIlvlAt = prev?.peakIlvlAt;
      } else if (prev?.peakIlvl == null) {
        peakIlvl = currentIlvl;
        peakIlvlAt = now;
      } else if (currentIlvl > prev.peakIlvl) {
        peakIlvl = currentIlvl;
        peakIlvlAt = now;
      } else {
        peakIlvl = prev.peakIlvl;
        peakIlvlAt = prev.peakIlvlAt;
      }

      // Last key ilvl: prefer the freshly-fetched run-details reading.
      // Carries forward when no new key activity since last snapshot.
      const freshKey = lastKeyByChar.get(lookupKey);
      let lastKeyIlvl: number | undefined;
      let lastKeyAt: number | undefined;
      if (freshKey) {
        lastKeyIlvl = freshKey.ilvl;
        lastKeyAt = freshKey.at;
      } else {
        lastKeyIlvl = prev?.lastKeyIlvl;
        lastKeyAt = prev?.lastKeyAt;
      }

      // Last raid ilvl: prefer BNet's per-character per-encounter
      // `last_kill_timestamp` (advances on every kill, including farm
      // re-kills). Falls back to the legacy `tierKillsTotal` advance
      // check for the cold-start case where no prior BNet baseline
      // exists yet. Without the BNet signal we'd miss anyone whose kill
      // count is already maxed at the active difficulties (a Heroic farm
      // night for a fully-cleared roster member leaves their RIO
      // tierKillsTotal flat). The Mitzis-style "PvP gear stamped as raid
      // gear" risk is bounded because we only stamp when we've actually
      // detected a fresh raid kill within the last snapshot window.
      let lastRaidIlvl: number | undefined;
      let lastRaidAt: number | undefined;
      const prevKills = prev?.tierKillsTotal;
      const charLastRaidKillTs = lastRaidKillByChar.get(lookupKey) ?? 0;
      const bnetAdvanced =
        charLastRaidKillTs > 0 &&
        (prev?.lastRaidAt == null || charLastRaidKillTs > prev.lastRaidAt);
      const rioCountAdvanced =
        prevKills !== undefined && tierKillsTotal > prevKills;
      if (bnetAdvanced && currentIlvl != null) {
        lastRaidIlvl = currentIlvl;
        lastRaidAt = charLastRaidKillTs;
      } else if (rioCountAdvanced && currentIlvl != null) {
        lastRaidIlvl = currentIlvl;
        lastRaidAt = now;
      } else {
        lastRaidIlvl = prev?.lastRaidIlvl;
        lastRaidAt = prev?.lastRaidAt;
      }

      return {
        ...character,
        lastRunAt,
        peakIlvl,
        peakIlvlAt,
        lastKeyIlvl,
        lastKeyAt,
        lastRaidIlvl,
        lastRaidAt,
        tierKillsTotal,
        tierKillsHM,
        raidsWithGuild: guildRaiderKeys.has(lookupKey),
        isGuildLeader: isLeader,
        // Officers are everyone at OFFICER_RANK_THRESHOLD or higher (lower
        // rankNumber) who isn't a leader OR a leader's alt — the parked
        // rank-0 alt would otherwise grab an Officer badge.
        isOfficer:
          !isLeader &&
          !leaderCharNamesLc.has(nameLc) &&
          character.rankNumber <= OFFICER_RANK_THRESHOLD,
      };
    });

    const allRuns = collectAllRuns(activeEnriched);
    const recentRuns = topNewestRuns(allRuns, 12);
    const sinceReset = getLastUSResetMs();
    // For weekly views, union allRuns with each character's
    // weekly-highest-level runs. RIO caps recent-runs at ~10 per character,
    // so high keys can scroll off — the weekly-highest field is the
    // authoritative source for "this week's best per dungeon" per character.
    const weeklyPool = unionRunsByUrl(
      allRuns,
      collectWeeklyHighestRuns(activeEnriched),
    );
    const weeklyTopRuns = topRunsThisWeek(weeklyPool, 150, sinceReset);
    const weeklyTopByCharacter = topByCharacterThisWeek(
      weeklyPool,
      WEEKLY_KEYS_MAX_CHARACTERS,
      WEEKLY_KEYS_RUNS_PER_CHARACTER,
      sinceReset,
    );

    // Carry-forward last week's pushers across the reset boundary. RIO's
    // weekly-highest endpoint only returns the current reset cycle, so once
    // Tuesday 8 AM PT passes, last week's data is unreachable from the API.
    // The previously bundled snapshot still has it, though — if that snapshot
    // was fetched *before* the current reset, its weeklyTopByCharacter IS
    // last week's bucket. Capture it once on the first post-reset cron, then
    // pass through the already-captured value on subsequent cron runs within
    // the same week.
    const bundledFetchedMs = Date.parse(
      bundledFile.snapshot.fetchedAt ?? "",
    );
    const previousWeekTopByCharacter: CharacterWeeklyKeys[] =
      Number.isFinite(bundledFetchedMs) && bundledFetchedMs < sinceReset
        ? (bundledFile.snapshot.weeklyTopByCharacter ?? [])
        : (bundledFile.snapshot.previousWeekTopByCharacter ?? []);

    const { resilient, rioCharacterIds } = await computeResilientAchievements(
      activeEnriched,
      bundledFile.snapshot.rioCharacterIds,
      bundledFile.snapshot.resilient ?? [],
      bundledFile.snapshot.roster ?? [],
    );

    const seasonTitles = await computeSeasonTitles(
      active,
      bundledFile.snapshot.seasonTitles ?? [],
      bundledFile.snapshot.roster ?? [],
    );

    return {
      source: "raiderio",
      fetchedAt: new Date().toISOString(),
      roster: active,
      tiers,
      rankings: guildRankings,
      affixes: affixes ?? undefined,
      tierSlug,
      tierIconUrl: tierMeta?.iconUrl,
      tierExpansionName: tierMeta?.expansionName,
      recentRuns,
      weeklyTopRuns,
      weeklyTopByCharacter,
      previousWeekTopByCharacter,
      resilient,
      seasonTitles,
      rioCharacterIds,
    };
  } catch (e) {
    console.error("[raiderio] snapshot failed; using bundled fallback:", e);
    return await readFallbackSnapshot();
  }
}

async function fetchAffixes(): Promise<WeeklyAffixes | null> {
  try {
    const url = `${RIO_BASE}/mythic-plus/affixes?region=${GUILD.region}&locale=en`;
    const res = await fetch(url, { next: { revalidate: REVALIDATE.affixes } });
    if (!res.ok) return null;
    const data: {
      title: string;
      affix_details: {
        id: number;
        name: string;
        description: string;
        icon_url: string;
        wowhead_url: string;
      }[];
    } = await res.json();
    const affixes: Affix[] = (data.affix_details ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      iconUrl: a.icon_url,
      wowheadUrl: a.wowhead_url,
    }));
    return { title: data.title, affixes };
  } catch {
    return null;
  }
}

// Past raid kills are immutable — once a guild kills a boss, that record
// doesn't change. Cache the shaped result aggressively (30 days) so we don't
// re-fetch ~24 API calls every time a past-raid page is loaded.
const pastRaidCache = new Map<
  string,
  { value: PastRaidDetail; expiresAt: number }
>();
const PAST_RAID_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function attachKillRosters(
  data: RaidEncountersData,
  fallbackTierSlug: string | undefined,
): Promise<RaidEncountersData> {
  try {
    // Build a name → raid meta lookup so we can derive per-instance raid
    // slugs from BNet's instance names. Critical: the BNet "latest
    // expansion" might not match RIO's reported current tier for a given
    // character. For example, a character who hasn't done Midnight tier
    // shows up with TWW raids (Nerub-ar Palace, Liberation of Undermine)
    // in BNet, but their RIO progression still references "tier-mn-1".
    // Per-instance raid slug lookup handles both cases.
    const knownRaids = await getKnownRaids();

    type Target = {
      encounterId: number;
      raidSlug: string;
      bossSlug: string;
      difficulty: Difficulty;
    };
    const allDifficulties: Difficulty[] = ["Mythic", "Heroic", "Normal"];
    const targets: Target[] = [];

    // Per-instance: figure out the raid slug, fetch the encounter list,
    // and queue boss-kill fetches for each killed encounter.
    const instanceRaidSlugs = new Map<number, string>();
    for (const inst of data.instances) {
      // First try matching the instance name directly (works for
      // single-instance raids like "Manaforge Omega" or "Nerub-ar Palace").
      const fromName = knownRaids.get(inst.instanceName);
      const raidSlug = fromName?.slug ?? fallbackTierSlug;
      if (!raidSlug) continue;
      instanceRaidSlugs.set(inst.instanceId, raidSlug);
    }

    // Fetch raid metadata (encounter slugs) per unique raid slug, in parallel.
    const uniqueSlugs = Array.from(new Set(instanceRaidSlugs.values()));
    const raidMetaBySlug = new Map<
      string,
      Awaited<ReturnType<typeof fetchRaidMeta>>
    >();
    await Promise.all(
      uniqueSlugs.map(async (slug) => {
        const meta = await fetchRaidMeta(slug);
        if (meta) raidMetaBySlug.set(slug, meta);
      }),
    );

    for (const inst of data.instances) {
      const raidSlug = instanceRaidSlugs.get(inst.instanceId);
      if (!raidSlug) continue;
      const meta = raidMetaBySlug.get(raidSlug);
      if (!meta) continue;
      const nameToBoss = new Map<string, string>();
      for (const e of meta.encounters) {
        nameToBoss.set(e.name.toLowerCase(), e.slug);
      }
      for (const enc of inst.encounters) {
        const charKilledAny =
          enc.perDifficulty.MYTHIC ||
          enc.perDifficulty.HEROIC ||
          enc.perDifficulty.NORMAL ||
          enc.perDifficulty.LFR;
        if (!charKilledAny) continue;
        const slug = nameToBoss.get(enc.encounterName.toLowerCase());
        if (!slug) continue;
        for (const difficulty of allDifficulties) {
          targets.push({
            encounterId: enc.encounterId,
            raidSlug,
            bossSlug: slug,
            difficulty,
          });
        }
      }
    }

    if (targets.length === 0) return data;

    const results = await mapWithConcurrency(targets, 12, async (t) => ({
      encounterId: t.encounterId,
      difficulty: t.difficulty,
      kill: await fetchBossKill(t.raidSlug, t.bossSlug, t.difficulty),
    }));

    const byEncounterId = new Map<
      number,
      Partial<Record<Difficulty, BossKill["roster"]>>
    >();
    for (const r of results) {
      if (!r.kill) continue;
      const existing = byEncounterId.get(r.encounterId) ?? {};
      existing[r.difficulty] = r.kill.roster;
      byEncounterId.set(r.encounterId, existing);
    }

    return {
      ...data,
      instances: data.instances.map((inst) => ({
        ...inst,
        encounters: inst.encounters.map((enc) => {
          const rosters = byEncounterId.get(enc.encounterId);
          return rosters ? { ...enc, killRosters: rosters } : enc;
        }),
      })),
    };
  } catch (e) {
    console.error("[raiderio] attachKillRosters failed:", e);
    return data;
  }
}

export async function getPastRaidDetail(
  slug: string,
): Promise<PastRaidDetail | null> {
  const cached = pastRaidCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const detail = await _getPastRaidDetail(slug);
  if (detail) {
    pastRaidCache.set(slug, {
      value: detail,
      expiresAt: Date.now() + PAST_RAID_TTL_MS,
    });
  }
  return detail;
}

async function _getPastRaidDetail(
  slug: string,
): Promise<PastRaidDetail | null> {
  try {
    const [meta, knownRaids] = await Promise.all([
      fetchRaidMeta(slug),
      getKnownRaids(),
    ]);
    if (!meta) return null;
    const knownMeta = knownRaids.get(meta.name);
    const expansionName = knownMeta?.expansionName ?? "Unknown";
    const iconUrl = knownMeta?.iconUrl;

    // Try every (boss, difficulty). Successes = kills.
    const targets: { boss: string; difficulty: Difficulty }[] = [];
    for (const diff of ["Mythic", "Heroic", "Normal"] as Difficulty[]) {
      for (const enc of meta.encounters) {
        targets.push({ boss: enc.slug, difficulty: diff });
      }
    }
    const results = await mapWithConcurrency(targets, 10, async (t) =>
      fetchBossKill(slug, t.boss, t.difficulty),
    );
    const kills: Record<string, BossKill> = {};
    const totals = { Mythic: 0, Heroic: 0, Normal: 0 };
    for (const k of results) {
      if (!k) continue;
      kills[`${k.bossSlug}-${k.difficulty}`] = k;
      totals[k.difficulty] += 1;
    }

    const bossIcons = await resolveRaidBossIcons(meta.name);

    return {
      slug,
      name: meta.name,
      expansionName,
      iconUrl,
      encounters: meta.encounters.map((e) => ({
        name: e.name,
        slug: e.slug,
        iconUrl: bossIcons.get(normalizeBossNameKey(e.name)),
      })),
      kills,
      totals,
    };
  } catch (e) {
    console.error("[raiderio] past raid detail failed:", e);
    return null;
  }
}

async function fetchAllBossKills(
  raidSlug: string,
  encounters: { slug: string }[],
  killedSlugsByDiff: Record<Difficulty, string[]>,
): Promise<Record<string, BossKill>> {
  const targets: { boss: string; difficulty: Difficulty }[] = [];
  for (const diff of ["Mythic", "Heroic", "Normal"] as Difficulty[]) {
    for (const slug of killedSlugsByDiff[diff] ?? []) {
      targets.push({ boss: slug, difficulty: diff });
    }
  }
  const results = await mapWithConcurrency(targets, 10, async (t) =>
    fetchBossKill(raidSlug, t.boss, t.difficulty),
  );
  const out: Record<string, BossKill> = {};
  for (const k of results) {
    if (k) out[`${k.bossSlug}-${k.difficulty}`] = k;
  }
  return out;
}

/**
 * Determine which boss slugs are actually killed at each difficulty by
 * probing /guilds/boss-kill per boss. RIO returns `{}` (no `kill` field)
 * for unkilled, populated kill data for actual kills. Short-circuits when
 * the kill count is 0 (none killed) or equals the encounter count (full
 * clear ⇒ all killed) to avoid unnecessary RIO calls.
 */
async function probeKilledSlugsByDifficulty(
  raidSlug: string,
  encounters: { slug: string }[],
  counts: Record<Difficulty, number>,
): Promise<Record<Difficulty, string[]>> {
  const out: Record<Difficulty, string[]> = {
    Mythic: [],
    Heroic: [],
    Normal: [],
  };
  const probes: { diff: Difficulty; slug: string }[] = [];
  for (const diff of ["Mythic", "Heroic", "Normal"] as Difficulty[]) {
    const count = counts[diff] ?? 0;
    if (count <= 0) continue;
    if (count >= encounters.length) {
      // Full clear — RIO's count and the encounter list line up; no need
      // to probe individually.
      out[diff] = encounters.map((e) => e.slug);
      continue;
    }
    for (const e of encounters) {
      probes.push({ diff, slug: e.slug });
    }
  }
  if (probes.length === 0) return out;
  const results = await mapWithConcurrency(probes, 10, async (p) => {
    const kill = await fetchBossKill(raidSlug, p.slug, p.diff);
    return kill ? p : null;
  });
  for (const r of results) {
    if (r) out[r.diff].push(r.slug);
  }
  // Preserve raid encounter order within each diff bucket for stable
  // downstream rendering (e.g. roster lookup ordering).
  const orderIndex = new Map(encounters.map((e, i) => [e.slug, i]));
  for (const diff of ["Mythic", "Heroic", "Normal"] as Difficulty[]) {
    out[diff].sort(
      (a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0),
    );
  }
  return out;
}

async function fetchBossKill(
  raidSlug: string,
  bossSlug: string,
  difficulty: Difficulty,
): Promise<BossKill | null> {
  try {
    const url =
      `${RIO_BASE}/guilds/boss-kill?region=${GUILD.region}` +
      `&realm=${GUILD.realm}` +
      `&guild=${encodeURIComponent(GUILD.name)}` +
      `&raid=${raidSlug}` +
      `&boss=${bossSlug}` +
      `&difficulty=${difficulty.toLowerCase()}`;
    // Bounded retry on transient RIO failures (429/5xx). The probe pattern
    // calls this in bursts of up to 27 (9 bosses × 3 difficulties), which
    // can trip RIO's per-IP rate limit — without a retry, those probes
    // return null and the snapshot under-reports kills. Honor RIO's
    // Retry-After header when present; otherwise back off exponentially.
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(url, {
        next: { revalidate: REVALIDATE.bossKill },
      });
      if (res.ok) break;
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10);
        const waitMs = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 400 * (attempt + 1);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      // Non-retryable 4xx (e.g. 404 — no kill on record). Stop early.
      return null;
    }
    if (!res || !res.ok) return null;
    const data: {
      kill?: {
        defeatedAt: string;
        durationMs: number;
        itemLevelEquippedAvg: number;
      };
      roster?: {
        character: {
          name: string;
          realm: { slug: string; name: string } | string;
          race: { faction: "alliance" | "horde" };
          class: { name: string };
          spec: { name: string; role: string };
        };
      }[];
    } = await res.json();
    if (!data.kill) return null;

    const roster: KillParticipant[] = (data.roster ?? []).map((r) => {
      const realmName =
        typeof r.character.realm === "string"
          ? r.character.realm
          : r.character.realm.name;
      const realmSlug =
        typeof r.character.realm === "string"
          ? slugifyRealm(r.character.realm)
          : r.character.realm.slug;
      const role =
        r.character.spec.role === "tank"
          ? "tank"
          : r.character.spec.role === "healer"
          ? "healer"
          : "dps";
      return {
        // Strip RIO's "-1234567" disambiguator suffix for cross-realm name collisions
        name: fixMojibake(r.character.name.replace(/-\d+$/, "")),
        realm: realmName,
        realmSlug,
        class: classToKey(r.character.class.name),
        spec: r.character.spec.name,
        role,
      };
    });

    return {
      bossSlug,
      difficulty,
      defeatedAt: data.kill.defeatedAt,
      durationMs: data.kill.durationMs,
      avgIlvl: data.kill.itemLevelEquippedAvg,
      roster,
    };
  } catch {
    return null;
  }
}

type RioCharacterProfile = {
  thumbnail_url?: string;
  gear?: {
    /** ISO8601 timestamp of RIO's last gear refresh for this character.
     *  RIO scrapes Blizzard's armory whenever the player logs out OR
     *  completes an instance encounter (M+ run, raid boss kill). So this
     *  timestamp ≈ when the player last did something that committed their
     *  equipped gear. Critical for the activity-gated peakKeyIlvl logic:
     *  if `updated_at` lands within minutes of `lastRunAt` (most recent M+
     *  run), we can be confident the `item_level_equipped` we're looking
     *  at is the gear they wore during that key — not gear they swapped
     *  to after the fact. */
    updated_at?: string;
    item_level_equipped?: number;
    /** Per-slot equipped items keyed by slot name (e.g. "head", "mainhand").
     *  Source of the corrected fractional ilvl computation in
     *  computeEquippedIlvl — RIO's own `item_level_equipped` field divides
     *  by however many items the slot map contains, which is wrong for 2H
     *  / ranged wielders (no offhand → divides by 15, but in-game the 2H
     *  weapon counts double across 16 slots). */
    items?: Record<string, { item_level?: number }>;
  };
  mythic_plus_scores_by_season?: {
    season: string;
    scores?: {
      all?: number;
      tank?: number;
      healer?: number;
      dps?: number;
    };
    segments?: { all?: { score?: number; color?: string } };
  }[];
  mythic_plus_ranks?: RioRanksFull;
  raid_progression?: Record<
    string,
    {
      total_bosses?: number;
      normal_bosses_killed?: number;
      heroic_bosses_killed?: number;
      mythic_bosses_killed?: number;
    }
  >;
  mythic_plus_recent_runs?: RioRun[];
  /** Per-dungeon highest-level keys this character ran since the weekly
   *  reset. RIO caps `mythic_plus_recent_runs` at ~10 entries, so a
   *  character who's done many keys this week will have their top keys
   *  scroll off the recent list — this field is the authoritative source
   *  for "this week's bests" per character. */
  mythic_plus_weekly_highest_level_runs?: RioRun[];
  /** Best run per active-season dungeon (one entry per dungeon when fetched
   *  with the `:all` modifier). Used together with alternate_runs to
   *  compute Resilient tier + earned date. */
  mythic_plus_best_runs?: RioRun[];
  /** Non-best runs per dungeon — everything that's NOT the top-scored.
   *  RIO's profile endpoint appears to return this empty most of the time
   *  in practice; kept as a defensive fallback. */
  mythic_plus_alternate_runs?: RioRun[];
  /** Top ~10 highest-leveled runs across the season (not per dungeon).
   *  Often surfaces earlier timed runs at the player's peak level that
   *  best_runs hides (because best_runs only keeps the single highest-
   *  scored run per dungeon). Crucial for accurate Resilient earnedAt. */
  mythic_plus_highest_level_runs?: RioRun[];
  /** Per-dungeon highest from the prior weekly reset — extends history
   *  another week beyond mythic_plus_weekly_highest_level_runs. */
  mythic_plus_previous_weekly_highest_level_runs?: RioRun[];
};

type CharKills = { normal: number; heroic: number; mythic: number };
type EnrichedCharacter = {
  character: Character;
  kills: CharKills;
  rank: number;
  recentRuns: MythicPlusRun[];
  /** Per-dungeon highest-level keys this character did since reset,
   *  straight from RIO's `mythic_plus_weekly_highest_level_runs`. Source
   *  of truth for the WeeklyKeysFeed because recentRuns can lose the
   *  high keys once a character does many more lower keys. */
  weeklyHighestRuns: MythicPlusRun[];
  /** Best run per active-season dungeon, from RIO `mythic_plus_best_runs:all`.
   *  Used to compute Resilient tier (min level across the set). */
  bestRuns: MythicPlusRun[];
  /** Non-best runs per dungeon. Often empty in practice; defensive. */
  alternateRuns: MythicPlusRun[];
  /** ~10 highest-leveled runs across the season (RIO `mythic_plus_highest_level_runs`). */
  highestLevelRuns: MythicPlusRun[];
  /** Per-dungeon highest from the previous weekly reset. */
  previousWeeklyHighestRuns: MythicPlusRun[];
  /** Role-partitioned timed runs (>=+12) from raider.io's internal
   *  `/api/characters/mythic-plus-runs` endpoint. RIO's public profile
   *  endpoint caps every run-list at ~10 entries, which displaces older
   *  +X timed runs once a player pushes higher in that dungeon. The
   *  internal endpoint partitions by role spec, so iterating tank/healer/
   *  dps/all gives us ~30-40 unique runs per character — enough for
   *  accurate "earliest timed at +X per dungeon" lookups (which the
   *  Resilient earnedAt algorithm depends on). */
  fullRoleRuns: MythicPlusRun[];
  /** Unix ms timestamp of most recent M+ run, 0 if none */
  lastRunAt: number;
  /** Unix ms timestamp of RIO's last gear refresh (M+ completion, raid
   *  encounter, or logout). Used by the active-in-keys gate: when it
   *  matches `lastRunAt` within a few minutes, we know the current gear
   *  reading is what they wore during that key. 0 if unknown. */
  gearUpdatedAt: number;
};

/** Fallback path for the snapshot when RIO's bulk guild-members response
 *  drops a leader. Fetches the character profile directly by name and
 *  shapes it into the same EnrichedCharacter form as enrichRoster, so the
 *  rest of the snapshot pipeline doesn't need to know about the gap. */
async function fetchLeaderAsEnriched(
  canonicalName: string,
  realmSlug: string = GUILD.realm,
): Promise<EnrichedCharacter | null> {
  const url =
    `${RIO_BASE}/characters/profile?region=${GUILD.region}` +
    `&realm=${realmSlug}` +
    `&name=${encodeURIComponent(canonicalName)}` +
    `&fields=gear,${SEASON_FIELD},mythic_plus_ranks,raid_progression,mythic_plus_recent_runs,mythic_plus_weekly_highest_level_runs,mythic_plus_best_runs:all,mythic_plus_alternate_runs:all,mythic_plus_highest_level_runs,mythic_plus_previous_weekly_highest_level_runs`;
  const res = await fetch(url, { next: { revalidate: REVALIDATE.guild } });
  if (!res.ok) return null;
  let p: RioCharacterProfile & {
    name: string;
    realm: string;
    faction: "alliance" | "horde";
    race: string;
    class: string;
    active_spec_name: string;
    active_spec_role: "TANK" | "HEALING" | "DPS";
    profile_url?: string;
    mythic_plus_recent_runs?: RioRun[];
    mythic_plus_weekly_highest_level_runs?: RioRun[];
    mythic_plus_best_runs?: RioRun[];
    mythic_plus_alternate_runs?: RioRun[];
    mythic_plus_highest_level_runs?: RioRun[];
    mythic_plus_previous_weekly_highest_level_runs?: RioRun[];
  };
  try {
    p = await res.json();
  } catch {
    return null;
  }
  const season = p.mythic_plus_scores_by_season?.[0];
  const score = season?.segments?.all?.score ?? season?.scores?.all ?? 0;
  const color = season?.segments?.all?.color;
  const roleScores = {
    tank: season?.scores?.tank ?? 0,
    healer: season?.scores?.healer ?? 0,
    dps: season?.scores?.dps ?? 0,
  };
  const tier = pickCharacterCurrentTier(p.raid_progression)?.tier;
  const kills: CharKills = {
    normal: tier?.normal_bosses_killed ?? 0,
    heroic: tier?.heroic_bosses_killed ?? 0,
    mythic: tier?.mythic_bosses_killed ?? 0,
  };
  const role = roleFromRio(p.active_spec_role);
  const roleRank = pickClassRoleRank(p.mythic_plus_ranks, role);
  let avatarUrl = p.thumbnail_url;
  if (!avatarUrl) {
    const fallback = await getCharacterAvatar(realmSlug, p.name);
    if (fallback) avatarUrl = fallback;
  }
  const [claimedOwner, bnetEquip] = await Promise.all([
    fetchClaimedOwner(realmSlug, p.name),
    getCharacterEquipment(realmSlug, p.name).catch(() => null),
  ]);
  // Max of RIO and BNet — both produce fractional via the 16-slot game
  // formula, so we pick whichever caught the most-recent equip change.
  // Matches the enrichRoster path.
  const rioIlvl = computeEquippedIlvl(p.gear?.items);
  const bnetIlvl = bnetEquip?.ilvl;
  const currentIlvl =
    rioIlvl != null || bnetIlvl != null
      ? Math.max(rioIlvl ?? 0, bnetIlvl ?? 0)
      : undefined;
  return {
    character: {
      name: fixMojibake(p.name),
      realm: p.realm,
      realmSlug,
      class: classToKey(p.class),
      spec: p.active_spec_name,
      role,
      faction: p.faction,
      ilvl: currentIlvl,
      mythicPlusScore: score,
      mythicPlusScoreColor:
        color && color !== "#ffffff" ? color : undefined,
      roleScores,
      realmClassRank: roleRank?.realm,
      avatarUrl,
      profileUrl: p.profile_url,
      rank: "Member",
      rankNumber: 9,
      claimedOwner: claimedOwner ?? undefined,
    },
    kills,
    rank: 9,
    recentRuns: (p.mythic_plus_recent_runs ?? []).map(shapeRun),
    weeklyHighestRuns: (p.mythic_plus_weekly_highest_level_runs ?? []).map(
      shapeRun,
    ),
    bestRuns: (p.mythic_plus_best_runs ?? []).map(shapeRun),
    alternateRuns: (p.mythic_plus_alternate_runs ?? []).map(shapeRun),
    highestLevelRuns: (p.mythic_plus_highest_level_runs ?? []).map(shapeRun),
    previousWeeklyHighestRuns: (
      p.mythic_plus_previous_weekly_highest_level_runs ?? []
    ).map(shapeRun),
    fullRoleRuns: [], // leader fallback path doesn't fetch role runs
    lastRunAt: latestRunTimestamp(p.mythic_plus_recent_runs ?? []),
    gearUpdatedAt: parseRioTimestamp(p.gear?.updated_at),
  };
}

async function enrichRoster(
  members: { character: Character; rank: number; lastCrawledAt?: string }[],
): Promise<EnrichedCharacter[]> {
  // Incremental enrichment: reuse last hour's shaped EnrichedCharacter for any
  // member whose RIO `last_crawled_at` is unchanged (RIO hasn't re-crawled them
  // ⇒ their profile data is identical), skipping the ~10-15 MB profile fetch +
  // parse + run-shaping. That parse, ×~60 chars/hour, is snapshot-export's
  // dominant Active-CPU cost. See lib/enrichment-cache.ts.
  //
  // Two guards keep this byte-identical to the all-fresh path:
  //   - We re-stamp the live guild-member identity (rank/label/spec) over the
  //     cached RIO-derived fields, so a promotion/role change on an idle char
  //     still shows immediately (those come from the guild fetch, not RIO).
  //   - During the weekly reset window we ignore the cache entirely and refetch
  //     everyone, so RIO's shifted weekly buckets are always captured.
  const forceRefresh = isWeeklyResetWindow();
  const cacheKeys = members.map((m) =>
    enrichCacheKey(m.character.realmSlug, m.character.name),
  );
  const cache = forceRefresh
    ? new Map<string, CachedEnrichment<EnrichedCharacter>>()
    : await loadEnrichmentCache<EnrichedCharacter>(cacheKeys);
  const toCache: { key: string; value: CachedEnrichment<EnrichedCharacter> }[] =
    [];

  const enriched = await mapWithConcurrency(
    members,
    ENRICHMENT_CONCURRENCY,
    async (m) => {
      const { character: c, rank, lastCrawledAt } = m;
      const cacheKey = enrichCacheKey(c.realmSlug, c.name);

      // Reuse path: same crawl stamp ⇒ RIO data unchanged. Overlay the fresh
      // guild-member identity (`c`) so rank/label/spec stay live; keep the
      // cached RIO-derived fields (scores/ilvl/avatar/claimedOwner) and all run
      // pools. The field list below MUST mirror what the fresh branch sets from
      // RIO, so a reused char is indistinguishable from a freshly-fetched one.
      const hit = lastCrawledAt ? cache.get(cacheKey) : undefined;
      if (hit && hit.lastCrawledAt === lastCrawledAt) {
        const cc = hit.enriched.character;
        return {
          ...hit.enriched,
          rank,
          character: {
            ...c,
            ilvl: cc.ilvl,
            mythicPlusScore: cc.mythicPlusScore,
            mythicPlusScoreColor: cc.mythicPlusScoreColor,
            roleScores: cc.roleScores,
            realmClassRank: cc.realmClassRank,
            avatarUrl: cc.avatarUrl,
            claimedOwner: cc.claimedOwner,
          },
        } satisfies EnrichedCharacter;
      }

      const { enriched: fresh, profileOk } = await buildEnrichedCharacter(
        c,
        rank,
      );
      // Don't let a transient claim-lookup miss erase an owner we already know.
      // Actively-played characters are re-crawled often, so they hit this fresh
      // path and re-fetch claimedOwner every build — one flaky miss would drop
      // the warband's bootstrap owner (and with it the whole group's alt
      // detection). Preserve any previously-cached owner when the fresh lookup
      // came back empty.
      if (!fresh.character.claimedOwner) {
        const prior = cache.get(cacheKey)?.enriched.character.claimedOwner;
        if (prior) fresh.character.claimedOwner = prior;
      }
      // Cache only complete entries with a crawl stamp to validate against.
      // Skipping stubs (profileOk=false) means a transient RIO failure retries
      // next hour instead of freezing an empty enrichment in the cache.
      if (lastCrawledAt && profileOk) {
        toCache.push({
          key: cacheKey,
          value: { lastCrawledAt, enriched: fresh },
        });
      }
      return fresh;
    },
  );

  // Persist the freshly-built entries for next hour. Best-effort, never throws.
  await saveEnrichmentCache(toCache);

  // Resolve warband alts whose owner the per-character lookup missed (alts RIO
  // hasn't re-crawled since the claim). Runs after the main pass so it can use
  // the owners we DID resolve to pull each warband and stamp the laggards.
  await backfillWarbandOwners(enriched);
  return enriched;
}

/** Fetch + shape a single character into an EnrichedCharacter. Extracted from
 *  enrichRoster so the incremental-cache reuse path and the fresh path share
 *  one definition of "what a fresh enrichment looks like."
 *
 *  `profileOk` is false when RIO's profile fetch failed and we returned a stub
 *  (no score, no runs). The caller MUST NOT cache a stub — otherwise a transient
 *  RIO failure would freeze a non-pinned char's empty enrichment in the cache
 *  until their `last_crawled_at` changes (up to the 14-day TTL). Let next hour
 *  retry instead. */
async function buildEnrichedCharacter(
  c: Character,
  rank: number,
): Promise<{ enriched: EnrichedCharacter; profileOk: boolean }> {
  {
    // Profile + claimed-owner + BNet equipment fetched in parallel: same
    // character, three endpoints. Wall time is bounded by the slowest
    // call (typically RIO profile), so adding the BNet equipment read
    // for the max-of-both ilvl strategy is effectively free.
    const [profile, claimedOwner, bnetEquip] = await Promise.all([
      fetchCharacterProfile(c.realm, c.name),
      fetchClaimedOwner(c.realmSlug, c.name),
      getCharacterEquipment(c.realmSlug, c.name).catch(() => null),
    ]);
    const empty: CharKills = { normal: 0, heroic: 0, mythic: 0 };
    const zeroScores = { tank: 0, healer: 0, dps: 0 };
    if (!profile)
      return {
        enriched: {
          character: {
            ...c,
            roleScores: zeroScores,
            claimedOwner: claimedOwner ?? undefined,
            ilvl: bnetEquip?.ilvl ?? undefined,
          },
          kills: empty,
          rank,
          recentRuns: [],
          weeklyHighestRuns: [],
          bestRuns: [],
          alternateRuns: [],
          highestLevelRuns: [],
          previousWeeklyHighestRuns: [],
          fullRoleRuns: [],
          lastRunAt: 0,
          gearUpdatedAt: 0,
        },
        profileOk: false,
      };
    const season = profile.mythic_plus_scores_by_season?.[0];
    const score = season?.segments?.all?.score ?? season?.scores?.all ?? 0;
    const color = season?.segments?.all?.color;
    const roleScores = {
      tank: season?.scores?.tank ?? 0,
      healer: season?.scores?.healer ?? 0,
      dps: season?.scores?.dps ?? 0,
    };
    const tier = pickCharacterCurrentTier(profile.raid_progression)?.tier;
    const kills: CharKills = {
      normal: tier?.normal_bosses_killed ?? 0,
      heroic: tier?.heroic_bosses_killed ?? 0,
      mythic: tier?.mythic_bosses_killed ?? 0,
    };
    const roleRank = pickClassRoleRank(profile.mythic_plus_ranks, c.role);
    // Fall back to BNet character-media if RIO didn't return a thumbnail.
    // Happens occasionally for transferred characters or RIO data gaps —
    // e.g. Anorxxorcist's avatar dropping out on a snapshot rebuild. Only
    // hits BNet when needed so it adds 0 calls in the common case.
    let avatarUrl = profile.thumbnail_url;
    if (!avatarUrl) {
      const fallback = await getCharacterAvatar(c.realmSlug, c.name);
      if (fallback) avatarUrl = fallback;
    }
    // Take the higher of RIO's and BNet's readings. Both now go through
    // the same 16-slot game formula (computeEquippedIlvl for RIO inline
    // here; getCharacterEquipment does the same math against BNet items),
    // so both produce fractional values — neither source is the "decimals"
    // source anymore. Which one is fresher is what differs: RIO only
    // refreshes on player logout / M+ completion, BNet's armory is
    // generally faster to reflect upgrades. Max-of-both catches whichever
    // saw the latest equip event.
    const rioIlvl = computeEquippedIlvl(profile.gear?.items);
    const bnetIlvl = bnetEquip?.ilvl;
    const currentIlvl =
      rioIlvl != null || bnetIlvl != null
        ? Math.max(rioIlvl ?? 0, bnetIlvl ?? 0)
        : undefined;
    const enriched: EnrichedCharacter = {
      character: {
        ...c,
        ilvl: currentIlvl,
        mythicPlusScore: score,
        mythicPlusScoreColor:
          color && color !== "#ffffff" ? color : undefined,
        roleScores,
        realmClassRank: roleRank?.realm,
        avatarUrl,
        claimedOwner: claimedOwner ?? undefined,
      },
      kills,
      rank,
      recentRuns: (profile.mythic_plus_recent_runs ?? []).map(shapeRun),
      weeklyHighestRuns: (
        profile.mythic_plus_weekly_highest_level_runs ?? []
      ).map(shapeRun),
      bestRuns: (profile.mythic_plus_best_runs ?? []).map(shapeRun),
      alternateRuns: (profile.mythic_plus_alternate_runs ?? []).map(shapeRun),
      highestLevelRuns: (profile.mythic_plus_highest_level_runs ?? []).map(
        shapeRun,
      ),
      previousWeeklyHighestRuns: (
        profile.mythic_plus_previous_weekly_highest_level_runs ?? []
      ).map(shapeRun),
      // Populated later by computeResilientAchievements (which fetches
      // raider.io's role-partitioned endpoint). Leave empty here.
      fullRoleRuns: [],
      lastRunAt: latestRunTimestamp(profile.mythic_plus_recent_runs ?? []),
      gearUpdatedAt: parseRioTimestamp(profile.gear?.updated_at),
    };
    return { enriched, profileOk: true };
  }
}

/** Parse RIO's ISO8601 timestamp strings (e.g. "2026-05-27T20:10:00.000Z")
 *  to unix ms, returning 0 on missing / invalid input. RIO uses ISO8601
 *  consistently for both `gear.updated_at` and `mythic_plus_recent_runs[].
 *  completed_at`, so the same helper works for either. */
function parseRioTimestamp(s: string | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/** Extract the keystone_run_id from a RIO run URL. URL shape:
 *  `https://raider.io/mythic-plus-runs/season-mn-1/30648183-11-algethar-academy`
 *  — the id is the first segment after the season slug. Returns undefined
 *  if the URL doesn't match (defensive). */
function extractKeystoneRunId(url: string | undefined): number | undefined {
  if (!url) return undefined;
  const m = url.match(/\/mythic-plus-runs\/[^/]+\/(\d+)/);
  if (!m) return undefined;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Fetch the per-run gear ilvl for a character's most recent M+ key. RIO's
 * `/api/v1/mythic-plus/run-details?id=...&season=...` endpoint returns the
 * run roster with each character's `items.item_level_equipped` captured at
 * the moment of the run — the exact gear they wore in that key. We find
 * the calling character in the roster by name + realm slug.
 *
 * Used in the snapshot pipeline to populate `lastKeyIlvl` precisely
 * (rather than approximating via snapshot-time gear), so the home page
 * "In Keys" view can't be gamed by gear swaps after a key completes.
 *
 * Returns null if there's no recent run, the run URL doesn't parse, or
 * RIO doesn't include the character in the run roster (rare edge case
 * with realm name vs slug mismatches).
 */
async function fetchLastKeyIlvl(
  recentRuns: { url?: string; keystone_run_id?: number; completed_at?: string }[],
  realmSlug: string,
  characterName: string,
): Promise<{ ilvl: number; at: number } | null> {
  if (!recentRuns?.length) return null;
  // Sort by completed_at desc so we always sample the most recent. RIO's
  // own ordering is usually most-recent-first but defensive sort is cheap.
  const sorted = [...recentRuns].sort(
    (a, b) =>
      parseRioTimestamp(b.completed_at) - parseRioTimestamp(a.completed_at),
  );
  const latest = sorted[0];
  if (!latest?.keystone_run_id || !latest.url) return null;
  // Season slug lives in the run URL: `.../mythic-plus-runs/season-mn-1/<id>-...`
  const seasonMatch = latest.url.match(/\/mythic-plus-runs\/([^/]+)\//);
  const season = seasonMatch?.[1];
  if (!season) return null;
  try {
    const res = await fetch(
      `${RIO_BASE}/mythic-plus/run-details?id=${latest.keystone_run_id}&season=${season}`,
      { next: { revalidate: REVALIDATE.guild } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      roster?: {
        character?: { name?: string; realm?: { slug?: string } | string };
        items?: { item_level_equipped?: number };
      }[];
    };
    const nameLc = characterName.toLowerCase();
    const realmLc = realmSlug.toLowerCase();
    const member = body.roster?.find((m) => {
      if (m.character?.name?.toLowerCase() !== nameLc) return false;
      const r = m.character?.realm;
      const rSlug =
        typeof r === "string" ? r.toLowerCase() : r?.slug?.toLowerCase();
      return rSlug === realmLc;
    });
    const ilvl = member?.items?.item_level_equipped;
    if (typeof ilvl !== "number" || !Number.isFinite(ilvl)) return null;
    return { ilvl, at: parseRioTimestamp(latest.completed_at) };
  } catch {
    return null;
  }
}

/**
 * Enrich a list of runs with any recorded VODs raider.io has for them.
 *
 * RIO's profile/best-run endpoints don't include video metadata — only the
 * per-run `/mythic-plus/run-details` endpoint exposes the top-level
 * `videos[]` array (populated when a participant uploaded a Twitch/YouTube
 * recording of the key). We fetch run-details per run, concurrency-bounded,
 * and return a map keyed by the run URL so callers can splice `videos` onto
 * the matching GuildRun without mutating the snapshot.
 *
 * Each fetch is wrapped in Next's fetch cache (REVALIDATE.guild = 1h), so a
 * warm home page costs nothing; cold costs ≤ `runs.length` RIO calls. Runs
 * whose URL doesn't parse, or that 404/flake, simply get no entry.
 */
const RUN_VIDEO_CONCURRENCY = 6;

type RioRunVideo = {
  videoType?: string;
  videoId?: string | number;
  startVideoTimeSeconds?: number;
  thumbnailUrl?: string;
  character?: { name?: string };
};

export async function getRunVideos(
  runs: { url: string }[],
): Promise<Map<string, RunVideo[]>> {
  const out = new Map<string, RunVideo[]>();
  const targets = runs
    .map((r) => ({
      url: r.url,
      id: extractKeystoneRunId(r.url),
      season: r.url.match(/\/mythic-plus-runs\/([^/]+)\//)?.[1],
    }))
    .filter((t) => t.id && t.season);
  await mapWithConcurrency(targets, RUN_VIDEO_CONCURRENCY, async (t) => {
    try {
      const res = await fetch(
        `${RIO_BASE}/mythic-plus/run-details?id=${t.id}&season=${t.season}`,
        { next: { revalidate: REVALIDATE.guild } },
      );
      if (!res.ok) return;
      const body = (await res.json()) as { videos?: RioRunVideo[] };
      const videos = (body.videos ?? [])
        .map(shapeRunVideo)
        .filter((v): v is RunVideo => v !== null);
      if (videos.length) out.set(t.url, videos);
    } catch {
      /* leave this run without videos */
    }
  });
  return out;
}

function shapeRunVideo(v: RioRunVideo): RunVideo | null {
  const type = v.videoType === "youtube" ? "youtube" : v.videoType === "twitch" ? "twitch" : null;
  if (!type || v.videoId == null) return null;
  return {
    type,
    videoId: String(v.videoId),
    startSeconds: Math.max(0, Math.round(v.startVideoTimeSeconds ?? 0)),
    thumbnailUrl: v.thumbnailUrl,
    characterName: v.character?.name ? fixMojibake(v.character.name) : undefined,
  };
}

function collectAllRuns(enriched: EnrichedCharacter[]): GuildRun[] {
  return mergeRunsByUrl(enriched, (e) => e.recentRuns);
}

const RESILIENT_LEVEL_MIN = 12;

/** Compute "Resilient X" tier per character.
 *
 *  Algorithm (per the LIB owner's spec):
 *    1. Collect every TIMED run at +12 or higher per character. Pulls
 *       from every run-list RIO's public profile exposes, AND raider.io's
 *       internal `/api/characters/mythic-plus-runs` endpoint partitioned
 *       by role (tank/healer/dps/all) — the latter is required because
 *       the public profile fields all cap at ~10 entries, which hides
 *       older +X timed runs once a character pushes the dungeon higher.
 *    2. Resilient level = min over each dungeon's highest timed level.
 *       A character only qualifies if every active dungeon has a timed
 *       run. Minimum tier is +12 (per the in-game achievement).
 *    3. earnedAt = the timestamp the tier was actually unlocked:
 *         - For each dungeon, find the EARLIEST timed run at level >= X.
 *         - Take MAX across dungeons — that's when the last laggard
 *           dungeon crossed the threshold.
 *       Re-running a min-level dungeon later does NOT move earnedAt
 *       because the EARLIEST date in that dungeon stays put.
 *
 *  The internal endpoint needs raider.io's numeric character id, which
 *  we cache in snapshot.json (`rioCharacterIds`) so we only resolve each
 *  guildie once. */
async function computeResilientAchievements(
  enriched: EnrichedCharacter[],
  cachedIds: Record<string, number> | undefined,
  priorResilient: ResilientAchievement[],
  priorRoster: Character[],
): Promise<{
  resilient: ResilientAchievement[];
  rioCharacterIds: Record<string, number>;
}> {
  const idCache: Record<string, number> = { ...(cachedIds ?? {}) };

  // Incremental gate. A character's Resilient tier can only change if they ran
  // a NEW key, so we only fetch the (expensive) role-partitioned run history
  // and recompute for characters whose `lastRunAt` advanced since the prior
  // snapshot. Idle characters reuse their prior entry verbatim — collapsing
  // the ~64MB role-run fetch+parse (the snapshot's single biggest cost) down
  // to just the players who were active this hour. Resilient is a permanent
  // milestone (earnedAt never moves once set), so reuse is safe; a fresh +19
  // lands the character in `activeChars` and recomputes.
  const keyOf = (realmSlug: string, name: string) =>
    `${realmSlug}:${name}`.toLowerCase();
  const priorLastRunAt = new Map<string, number>();
  for (const c of priorRoster) {
    priorLastRunAt.set(keyOf(c.realmSlug, c.name), c.lastRunAt ?? 0);
  }
  const priorResilientByKey = new Map<string, ResilientAchievement>();
  for (const r of priorResilient) {
    priorResilientByKey.set(keyOf(r.runner.realmSlug, r.runner.name), r);
  }

  const activeChars: EnrichedCharacter[] = [];
  const reused: ResilientAchievement[] = [];
  for (const e of enriched) {
    const k = keyOf(e.character.realmSlug, e.character.name);
    const prior = priorLastRunAt.get(k);
    // Recompute if activity changed in EITHER direction: a new key advances
    // lastRunAt; an M+ season reset clears the run history and resets it. Only
    // a genuinely-unchanged lastRunAt counts as idle.
    const changed = prior === undefined || (e.lastRunAt ?? 0) !== prior;
    if (changed) {
      activeChars.push(e);
      continue;
    }
    // Idle: reuse the prior entry verbatim. Resilient is permanent and no new
    // key ran, so it cannot have changed — and reuse keeps the entry alive
    // through a transient RIO partial response that the old recompute-everyone
    // path would have dropped (e.g. a momentarily-empty best_runs list).
    const pr = priorResilientByKey.get(k);
    if (pr) reused.push(pr);
  }
  console.log(
    `[resilient] ${activeChars.length}/${enriched.length} active (role-runs fetched); ${reused.length} idle reused`,
  );

  // Fetch the role-partitioned history only for active characters.
  await mapWithConcurrency(activeChars, ENRICHMENT_CONCURRENCY, async (e) => {
    const charKey = e.character.name;
    let id = idCache[charKey];
    if (id === undefined) {
      const fetched = await fetchRioCharacterId(
        e.character.realm,
        e.character.name,
      );
      if (fetched !== null) {
        id = fetched;
        idCache[charKey] = fetched;
      }
    }
    if (id !== undefined) {
      try {
        e.fullRoleRuns = await fetchAllRoleRunsAtLeast12(id);
      } catch {
        e.fullRoleRuns = [];
      }
    }
  });

  // activeDungeons defines the season's dungeon pool — computed from ALL
  // characters' bestRuns (present on every char from enrichRoster), not just
  // the active subset, so the expectedCount denominator stays correct.
  const activeDungeons = new Set<string>();
  for (const e of enriched) {
    for (const run of e.bestRuns) {
      if (run.upgrades >= 1) activeDungeons.add(run.shortName);
    }
  }
  const expectedCount = activeDungeons.size;
  if (expectedCount === 0) {
    return {
      resilient: reused.sort(
        (a, b) =>
          new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime(),
      ),
      rioCharacterIds: idCache,
    };
  }

  const out: ResilientAchievement[] = [];
  for (const e of activeChars) {
    // UNION every timed run pool RIO surfaces for this character — public
    // profile fields plus raider.io's internal role-partitioned endpoint.
    // Dedupe by run URL where present (public profile entries have URLs);
    // role-runs from the internal endpoint use a synthetic key.
    const seen = new Set<string>();
    const allTimed: MythicPlusRun[] = [];
    const pools: MythicPlusRun[][] = [
      e.bestRuns,
      e.alternateRuns,
      e.highestLevelRuns,
      e.weeklyHighestRuns,
      e.previousWeeklyHighestRuns,
      e.recentRuns,
      e.fullRoleRuns,
    ];
    for (const pool of pools) {
      for (const run of pool) {
        if (run.upgrades < 1) continue;
        if (!activeDungeons.has(run.shortName)) continue;
        const dedupeKey =
          run.url ||
          `${run.shortName}@${run.level}@${run.completedAt}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        allTimed.push(run);
      }
    }

    // Each dungeon's highest timed level so far this season.
    const highestPerDungeon = new Map<string, number>();
    for (const run of allTimed) {
      const existing = highestPerDungeon.get(run.shortName) ?? 0;
      if (run.level > existing) highestPerDungeon.set(run.shortName, run.level);
    }
    // Must have a timed run in every active dungeon to have any Resilient tier.
    if (highestPerDungeon.size < expectedCount) continue;

    // Resilient level = min of the highest-per-dungeon.
    let resilientLevel = Infinity;
    for (const lvl of highestPerDungeon.values()) {
      if (lvl < resilientLevel) resilientLevel = lvl;
    }
    if (resilientLevel < RESILIENT_LEVEL_MIN) continue;

    // For each dungeon, the EARLIEST timed run at level >= resilientLevel.
    const earliestAtLevelMs = new Map<string, number>();
    for (const run of allTimed) {
      if (run.level < resilientLevel) continue;
      const ms = new Date(run.completedAt).getTime();
      const existing = earliestAtLevelMs.get(run.shortName);
      if (existing === undefined || ms < existing) {
        earliestAtLevelMs.set(run.shortName, ms);
      }
    }
    // earnedAt = MAX of those earliest dates (last dungeon to cross the line).
    let earnedMs = 0;
    for (const ms of earliestAtLevelMs.values()) {
      if (ms > earnedMs) earnedMs = ms;
    }
    const earnedAt = new Date(earnedMs).toISOString();

    out.push({
      runner: {
        name: e.character.name,
        realmSlug: e.character.realmSlug,
        class: e.character.class,
      },
      level: resilientLevel,
      earnedAt,
      score: e.character.mythicPlusScore ?? 0,
    });
  }

  // Merge freshly-computed (active) with reused (idle) entries, newest first.
  const sorted = [...out, ...reused].sort(
    (a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime(),
  );
  return { resilient: sorted, rioCharacterIds: idCache };
}

/** Like collectAllRuns but uses the per-character weekly-highest list as the
 *  source. Authoritative for "this week's best keys" because RIO's recent
 *  list is capped at ~10 entries per character. */
function collectWeeklyHighestRuns(enriched: EnrichedCharacter[]): GuildRun[] {
  return mergeRunsByUrl(enriched, (e) => e.weeklyHighestRuns);
}

function mergeRunsByUrl(
  enriched: EnrichedCharacter[],
  pick: (e: EnrichedCharacter) => MythicPlusRun[],
): GuildRun[] {
  // Group runs by URL — RIO surfaces each shared run independently for every
  // guildy participant, so a 5-person key with 3 guildies shows up 3 times.
  // Collapse to one row per unique run, listing every guildy as a runner.
  const byUrl = new Map<string, GuildRun>();
  for (const e of enriched) {
    const runner = {
      name: e.character.name,
      realmSlug: e.character.realmSlug,
      class: e.character.class,
    };
    for (const run of pick(e)) {
      const existing = byUrl.get(run.url);
      if (existing) {
        if (!existing.runners.some((r) => r.name === runner.name)) {
          existing.runners.push(runner);
        }
      } else {
        byUrl.set(run.url, { ...run, runners: [runner] });
      }
    }
  }
  return [...byUrl.values()];
}

/** Merge two GuildRun lists by URL, unioning their runner arrays so a
 *  guildy who appears in one list but not the other still gets credit. */
function unionRunsByUrl(a: GuildRun[], b: GuildRun[]): GuildRun[] {
  const byUrl = new Map<string, GuildRun>();
  for (const run of a) byUrl.set(run.url, { ...run, runners: [...run.runners] });
  for (const run of b) {
    const existing = byUrl.get(run.url);
    if (!existing) {
      byUrl.set(run.url, { ...run, runners: [...run.runners] });
      continue;
    }
    for (const runner of run.runners) {
      if (!existing.runners.some((r) => r.name === runner.name)) {
        existing.runners.push(runner);
      }
    }
  }
  return [...byUrl.values()];
}

function topNewestRuns(allRuns: GuildRun[], limit: number): GuildRun[] {
  return [...allRuns]
    .sort(
      (a, b) =>
        new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
    )
    .slice(0, limit);
}

function topRunsThisWeek(
  allRuns: GuildRun[],
  limit: number,
  sinceMs: number,
): GuildRun[] {
  return allRuns
    .filter((r) => new Date(r.completedAt).getTime() >= sinceMs)
    .sort((a, b) => b.score - a.score || b.level - a.level)
    .slice(0, limit);
}

const WEEKLY_KEYS_MAX_CHARACTERS = 12;
const WEEKLY_KEYS_RUNS_PER_CHARACTER = 3;

/** Bucket weekly runs by runner so the UI can render one card per
 *  character. Group keys with multiple guildies count toward each
 *  participant's bucket. */
export function topByCharacterThisWeek(
  allRuns: GuildRun[],
  charLimit: number,
  runsPerChar: number,
  sinceMs: number,
): CharacterWeeklyKeys[] {
  const weekly = allRuns.filter(
    (r) => new Date(r.completedAt).getTime() >= sinceMs,
  );
  const buckets = new Map<
    string,
    { runner: GuildRunner; runs: GuildRun[] }
  >();
  for (const run of weekly) {
    for (const runner of run.runners) {
      const key = `${runner.realmSlug}:${runner.name.toLowerCase()}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { runner, runs: [] };
        buckets.set(key, bucket);
      }
      bucket.runs.push(run);
    }
  }
  return [...buckets.values()]
    .map(({ runner, runs }) => {
      const sorted = runs
        .slice()
        .sort((a, b) => b.score - a.score || b.level - a.level);
      return {
        runner,
        runs: sorted.slice(0, runsPerChar),
        topScore: sorted[0]?.score ?? 0,
      };
    })
    .sort((a, b) => b.topScore - a.topScore)
    .slice(0, charLimit);
}

/**
 * Returns the unix-ms timestamp of the most recent US weekly reset
 * (Tuesday 08:00 America/Los_Angeles). Walks back in 1-hour steps so DST
 * transitions handle themselves — we don't need a tz library.
 */
export function getLastUSResetMs(nowMs = Date.now()): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  for (let i = 0; i < 7 * 24; i++) {
    const t = nowMs - i * 3600_000;
    let weekday = "";
    let hour = -1;
    let minute = -1;
    for (const p of fmt.formatToParts(t)) {
      if (p.type === "weekday") weekday = p.value;
      else if (p.type === "hour") hour = +p.value;
      else if (p.type === "minute") minute = +p.value;
    }
    if (weekday === "Tue" && hour === 8) {
      // Round down to the start of the 8 AM hour so the cutoff sits
      // exactly at reset, not at the moment we happened to scan.
      return t - minute * 60_000;
    }
  }
  // Fallback: 7 days ago. Should never hit unless Intl is broken.
  return nowMs - 7 * 24 * 3600_000;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

type Diff = "Mythic" | "Heroic" | "Normal";
type MinDiff = Diff | "Any" | "None";

function hardestGuildDifficulty(p: {
  normal_bosses_killed: number;
  heroic_bosses_killed: number;
  mythic_bosses_killed: number;
}): Diff | null {
  if (p.mythic_bosses_killed > 0) return "Mythic";
  if (p.heroic_bosses_killed > 0) return "Heroic";
  if (p.normal_bosses_killed > 0) return "Normal";
  return null;
}

function resolveMinDifficulty(guildHardest: Diff | null): MinDiff {
  switch (ROSTER_FILTER.mode) {
    case "auto":
      return guildHardest ?? "Any";
    case "mythic":
      return "Mythic";
    case "heroic":
      return "Heroic";
    case "normal":
      return "Normal";
    case "any":
      return "Any";
    case "none":
      return "None";
  }
}

function passesActivityFilter({
  kills,
  character,
  rank,
  minDiff,
  guildKillsAtHardest,
  lastRunAt,
}: {
  kills: CharKills;
  character: Character;
  rank: number;
  minDiff: MinDiff;
  guildKillsAtHardest: number;
  lastRunAt: number;
}): boolean {
  if (ROSTER_FILTER.alwaysShowRanks.includes(rank)) return true;

  const score = character.mythicPlusScore ?? 0;
  const isMplusPusher = score >= ROSTER_FILTER.mplusPusherScore;
  // Active current-tier raiders are never "abandoned" — they have kills
  // this tier, so the recency gate shouldn't drop them.
  const hasCurrentTierKills =
    kills.heroic + kills.mythic + kills.normal > 0;

  // Recency gate — drop characters with no recent M+ activity AND no
  // current-tier raid kills AND no high M+ score. Otherwise raid mains
  // who don't push keys (or M+ pushers between weeks) get axed.
  if (ROSTER_FILTER.recencyDays > 0 && !hasCurrentTierKills && !isMplusPusher) {
    const cutoff =
      Date.now() - ROSTER_FILTER.recencyDays * 24 * 60 * 60 * 1000;
    if (!lastRunAt || lastRunAt < cutoff) return false;
  }

  if (isMplusPusher) return true;

  // Otherwise, match guild progression at its hardest cleared difficulty.
  switch (minDiff) {
    case "None":
      return true;
    case "Any":
      return score > 0 || kills.normal + kills.heroic + kills.mythic > 0;
    case "Normal":
      return (
        kills.normal >= Math.max(1, guildKillsAtHardest - 1) ||
        kills.heroic + kills.mythic > 0
      );
    case "Heroic":
      return (
        kills.heroic >= Math.max(1, guildKillsAtHardest - 1) ||
        kills.mythic > 0
      );
    case "Mythic":
      return kills.mythic >= Math.max(1, guildKillsAtHardest - 1);
  }
}

import { cache } from "react";

// Cross-route shared cache for full character details. Pinned to globalThis
// so it persists across Next.js dev's per-route bundle isolation — without
// this, navigating between character tab pages (each its own bundle in dev)
// would re-fetch from scratch even though the data is identical.
//
// React's `cache()` is request-scoped — useful for de-duping calls inside a
// single render pass but doesn't persist across requests. The cache below
// does both: persists across requests AND across route bundles.
type GlobalCache = {
  characterDetailCache: Map<
    string,
    { value: CharacterDetail | null; expiresAt: number }
  >;
  characterDetailInFlight: Map<string, Promise<CharacterDetail | null>>;
  characterCoreCache: Map<
    string,
    { value: CharacterCore | null; expiresAt: number }
  >;
  characterCoreInFlight: Map<string, Promise<CharacterCore | null>>;
};
const globalStore = globalThis as unknown as { __libCache?: GlobalCache };
globalStore.__libCache ??= {
  characterDetailCache: new Map(),
  characterDetailInFlight: new Map(),
  characterCoreCache: new Map(),
  characterCoreInFlight: new Map(),
};
const characterDetailCache = globalStore.__libCache.characterDetailCache;
const characterDetailInFlight = globalStore.__libCache.characterDetailInFlight;
// 5 min — same reasoning as CHARACTER_CORE_TTL_MS below. The BNet fanout
// (talents, achievements, raid encounters) the detail layer adds on top
// of core is itself memoized through `memo()` calls per-endpoint, so the
// outer 5-min TTL doesn't cause a re-fanout storm — it just lets fresh
// gear/ilvl changes propagate quickly into the character page hero.
const CHARACTER_DETAIL_TTL_MS = 5 * 60 * 1000;

/**
 * The character page's prestige badges (AOTC/CE/HoF) + season-title stars,
 * sourced from the bundled snapshot instead of a live ~2.67MB BNet achievements
 * parse. The snapshot already derives these twice-daily (the same data shown on
 * the roster + Top Performers), so the character page reuses it for zero parse
 * cost. `enrichedRoster` is preferred (already has overrides applied); falls
 * back to `snapshot.roster`. Season-title overrides are applied here too so the
 * result is identical to the old live path regardless of source.
 */
export function getCharacterBadges(
  realmSlug: string,
  name: string,
): { tierBadges: RaidTierBadges | null; seasonTitles: CharacterSeasonTitle[] } {
  const realmKey = realmSlug.toLowerCase();
  const nameKey = name.toLowerCase();
  const match = (c: Character) =>
    c.realmSlug.toLowerCase() === realmKey &&
    c.name.toLowerCase() === nameKey;
  const src =
    bundledEnrichments.enrichedRoster.find(match) ??
    bundledSnapshot.roster.find(match);
  if (!src) return { tierBadges: null, seasonTitles: [] };
  return {
    tierBadges: src.tierBadges ?? null,
    // Idempotent: enrichedRoster entries already have overrides applied;
    // snapshot.roster entries may not — applying uniformly fixes both.
    seasonTitles: applyCharacterSeasonTitleOverrides(
      src.name,
      src.seasonTitles ?? [],
    ),
  };
}

/**
 * Achievements-tab summary, incremental on `achievement_points`. Backs the lazy
 * `/api/achievements` route the Achievements tab fetches when opened. The
 * ~2.67MB BNet blob is only re-fetched + re-parsed when the character's
 * achievement points changed since last cache; otherwise this returns the
 * cached summary from Upstash (a cheap Redis read). Fails safe to a live fetch
 * if Upstash is unconfigured/down — same behaviour as before this cache existed.
 */
export async function getCharacterAchievementsCached(
  realmSlug: string,
  name: string,
): Promise<AchievementSummary | null> {
  const realmKey = realmSlug.toLowerCase();
  const nameKey = name.toLowerCase();
  const entry =
    bundledSnapshot.roster.find(
      (c) =>
        c.realmSlug.toLowerCase() === realmKey &&
        c.name.toLowerCase() === nameKey,
    ) ??
    bundledEnrichments.enrichedRoster.find(
      (c) =>
        c.realmSlug.toLowerCase() === realmKey &&
        c.name.toLowerCase() === nameKey,
    );
  const points = entry?.achievementPoints;
  const key = achSummaryCacheKey(realmSlug, name);

  // Reuse the cached summary when achievement points are unchanged — no new
  // achievement means the totals/recent/categories can't have changed.
  if (points != null) {
    const cached = await loadAchSummaryCache<AchievementSummary>([key]);
    const hit = cached.get(key);
    if (hit && hit.points === points) return hit.summary;
  }

  const summary = await getCharacterAchievements(realmSlug, name);
  // Only cache real results against a known points value (never cache a
  // transient BNet null, else the tab would freeze empty for the TTL).
  if (summary && points != null) {
    await saveAchSummaryCache<AchievementSummary>([
      { key, value: { points, summary } },
    ]);
  }
  return summary;
}

export const getCharacterDetail = cache(_getCharacterDetailCached);

async function _getCharacterDetailCached(
  realmSlug: string,
  name: string,
): Promise<CharacterDetail | null> {
  const key = `${realmSlug.toLowerCase()}:${name.toLowerCase()}`;
  const hit = characterDetailCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const inFlight = characterDetailInFlight.get(key);
  if (inFlight) return inFlight;
  const promise = (async () => {
    try {
      const value = await _getCharacterDetail(realmSlug, name);
      characterDetailCache.set(key, {
        value,
        expiresAt: Date.now() + CHARACTER_DETAIL_TTL_MS,
      });
      return value;
    } finally {
      characterDetailInFlight.delete(key);
    }
  })();
  characterDetailInFlight.set(key, promise);
  return promise;
}

// ---- Character core: RIO-only fast path ----
// The character page layout calls this for the hero (avatar, name, ilvl,
// M+ score, ranks). It's a single RIO fetch — typically ~300-500ms cold.
// `getCharacterDetail` below wraps this and adds the slow BNet fanout
// (talents, raid encounters, achievements) used for the loadout + tabs.
const characterCoreCache = globalStore.__libCache.characterCoreCache;
const characterCoreInFlight = globalStore.__libCache.characterCoreInFlight;
// 5 min — the underlying RIO profile + BNet equipment already have their
// own caches (RIO 1h via Next fetch, BNet equipment no-cache). The outer
// CharacterCore cache used to be 1h, but stacked on the BNet/RIO caches
// it meant the character page hero stayed stuck on a stale ilvl + gear
// snapshot long after the inner sources had refreshed. 5 min keeps multi-
// page browsing fast without papering over fresh gear updates.
const CHARACTER_CORE_TTL_MS = 5 * 60 * 1000;

export const getCharacterCore = cache(_getCharacterCoreCached);

async function _getCharacterCoreCached(
  realmSlug: string,
  name: string,
): Promise<CharacterCore | null> {
  const key = `${realmSlug.toLowerCase()}:${name.toLowerCase()}`;
  const hit = characterCoreCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const inFlight = characterCoreInFlight.get(key);
  if (inFlight) return inFlight;
  const promise = (async () => {
    try {
      const value = await _fetchCharacterCore(realmSlug, name);
      characterCoreCache.set(key, {
        value,
        expiresAt: Date.now() + CHARACTER_CORE_TTL_MS,
      });
      return value;
    } finally {
      characterCoreInFlight.delete(key);
    }
  })();
  characterCoreInFlight.set(key, promise);
  return promise;
}

// All season slugs we ask RIO for, recent first. Add a new one to the top
// each time a season ships. Seasons not played by the character return
// score=0 in the response and are filtered out client-side.
// Historical season slugs we keep asking RIO for so past-season scores
// continue to appear on character profiles. New current-season slugs are
// auto-derived from the bundled snapshot's tierSlug (see CURRENT_SEASON_SLUG
// below) — no manual edit needed when a new season ships, as long as the
// snapshot's tierSlug has rolled over to the new tier.
//
// Seasons not played by the character return score=0 and are filtered
// out client-side, so over-asking is safe.
const HISTORICAL_SEASON_SLUGS = [
  "season-tww-3",
  "season-tww-2",
  "season-tww-1",
  "season-df-4",
  "season-df-3",
  "season-df-2",
  "season-df-1",
  "season-sl-4",
  "season-sl-3",
  "season-sl-2",
  "season-sl-1",
  "season-bfa-4",
  "season-bfa-3",
  "season-bfa-2",
  "season-bfa-1",
] as const;

// Derive the current-season slug from the bundled snapshot's tier slug
// ("tier-mn-1" → "season-mn-1"). RIO's slug naming is symmetric between
// raid tiers and M+ seasons, so this swap is reliable across expansions.
const CURRENT_SEASON_SLUG = bundledSnapshot.tierSlug?.startsWith("tier-")
  ? bundledSnapshot.tierSlug.replace(/^tier-/, "season-")
  : null;

const SEASON_SLUGS: readonly string[] = CURRENT_SEASON_SLUG &&
  !HISTORICAL_SEASON_SLUGS.includes(
    CURRENT_SEASON_SLUG as (typeof HISTORICAL_SEASON_SLUGS)[number],
  )
  ? [CURRENT_SEASON_SLUG, ...HISTORICAL_SEASON_SLUGS]
  : HISTORICAL_SEASON_SLUGS;

const SEASON_FIELD = `mythic_plus_scores_by_season:${SEASON_SLUGS.join(":")}`;

function labelForSeasonSlug(slug: string): string {
  // "season-mn-1" → ["mn", "1"]
  const parts = slug.replace(/^season-/, "").split("-");
  if (parts.length < 2) return slug;
  const exp = expansionLabelFromSlug(slug) ?? parts[0].toUpperCase();
  const num = parts[parts.length - 1];
  return `${exp} Season ${num}`;
}

async function _fetchCharacterCore(
  realmSlug: string,
  name: string,
): Promise<CharacterCore | null> {
  try {
    const url =
      `${RIO_BASE}/characters/profile?region=${GUILD.region}` +
      `&realm=${realmSlug}` +
      `&name=${encodeURIComponent(name)}` +
      `&fields=gear,${SEASON_FIELD},mythic_plus_ranks,raid_progression,mythic_plus_recent_runs,mythic_plus_best_runs`;
    // Pull RIO profile + BNet equipment in parallel. BNet is the source
    // of truth for current gear (RIO only refreshes on logout / M+, so a
    // gear swap after the last refresh shows stale RIO data — e.g.
    // someone in PvP gear who's actually running PvE 280s currently).
    const [res, bnetEquip] = await Promise.all([
      fetch(url, { next: { revalidate: REVALIDATE.guild } }),
      getCharacterEquipment(realmSlug, name).catch(() => null),
    ]);
    if (!res.ok) return null;
    const p: RioCharacterProfile & {
      name: string;
      realm: string;
      faction: "alliance" | "horde";
      race: string;
      class: string;
      active_spec_name: string;
      active_spec_role: "TANK" | "HEALING" | "DPS";
      achievement_points?: number;
      profile_url?: string;
      mythic_plus_recent_runs?: RioRun[];
      mythic_plus_best_runs?: RioRun[];
    } = await res.json();

    // Build season-score list from RIO's response. Seasons not played
    // come back with score=0 — drop those. Order returned by RIO matches
    // the order we requested (recent → old) so we can use it directly.
    const seasonScores: SeasonScore[] = (p.mythic_plus_scores_by_season ?? [])
      .map((s) => {
        const seg = s.segments?.all;
        const score = seg?.score ?? s.scores?.all ?? 0;
        return {
          slug: s.season,
          label: labelForSeasonSlug(s.season),
          score,
          color: seg?.color && seg.color !== "#ffffff" ? seg.color : undefined,
        };
      })
      .filter((s) => s.score > 0);

    const current = seasonScores[0];
    const score = current?.score ?? 0;
    const color = current?.color;
    const currentRaw = (p.mythic_plus_scores_by_season ?? [])[0];
    const roleScores = {
      tank: currentRaw?.scores?.tank ?? 0,
      healer: currentRaw?.scores?.healer ?? 0,
      dps: currentRaw?.scores?.dps ?? 0,
    };
    const pickedTier = pickCharacterCurrentTier(p.raid_progression);
    const tier = pickedTier?.tier;
    const tierSlug = pickedTier?.slug;
    const activeRole = roleFromRio(p.active_spec_role);
    // Match the rank pill to whichever role the character actually plays
    // most (highest M+ score) — otherwise we'd label the rank with the
    // active spec while displaying the preferred spec name.
    const dominantRole: Role =
      roleScores.tank > roleScores.healer && roleScores.tank > roleScores.dps && roleScores.tank > 0
        ? "tank"
        : roleScores.healer > roleScores.dps && roleScores.healer > 0
        ? "healer"
        : roleScores.dps > 0
        ? "dps"
        : activeRole;

    const pinOverride = ROSTER_PINS.find(
      (pin) => pin.name.toLowerCase() === p.name.toLowerCase(),
    );
    // Max of RIO and BNet using the proper 16-slot game formula. Matches
    // enrichRoster — keeps the character page hero and the home page in
    // agreement on the current reading.
    const rioIlvlCore = computeEquippedIlvl(
      (p as unknown as { gear?: { items?: Record<string, { item_level?: number }> } })
        .gear?.items,
    );
    const bnetIlvlCore = bnetEquip?.ilvl;
    const currentIlvlCore =
      rioIlvlCore != null || bnetIlvlCore != null
        ? Math.max(rioIlvlCore ?? 0, bnetIlvlCore ?? 0)
        : undefined;
    // Cross-reference the bundled snapshot for the high-water-mark peak.
    // Hero header + compare view show peakIlvl, so a PvP gear swap (or any
    // current-reading drop) won't tank a player's number on the drill-down
    // pages either. realmSlug+name keyed to avoid cross-realm collisions.
    const peakLookup = bundledFile.snapshot.roster.find(
      (r) =>
        r.realmSlug === realmSlug &&
        r.name.toLowerCase() === p.name.toLowerCase(),
    );
    return {
      name: p.name,
      realm: p.realm,
      realmSlug,
      faction: p.faction,
      race: p.race,
      className: p.class,
      classKey: classToKey(p.class),
      spec: pinOverride?.spec ?? p.active_spec_name,
      role: activeRole,
      ilvl: currentIlvlCore,
      peakIlvl: peakLookup?.peakIlvl,
      peakIlvlAt: peakLookup?.peakIlvlAt,
      mythicPlusScore: score,
      mythicPlusScoreColor: color,
      roleScores,
      seasonScores,
      achievementPoints: p.achievement_points,
      avatarUrl: p.thumbnail_url,
      profileUrl: p.profile_url,
      realmClassRank: pickClassRoleRank(p.mythic_plus_ranks, dominantRole)?.realm,
      regionClassRank: pickClassRoleRank(p.mythic_plus_ranks, dominantRole)?.region,
      worldClassRank: pickClassRoleRank(p.mythic_plus_ranks, dominantRole)?.world,
      recentRuns: (p.mythic_plus_recent_runs ?? []).map(shapeRun),
      bestRuns: (p.mythic_plus_best_runs ?? []).map(shapeRun),
      gear:
        bnetEquip?.items ??
        shapeGear(
          (p as unknown as { gear?: { items?: Record<string, RioGearItem> } })
            .gear?.items,
        ),
      currentTierSlug: tierSlug,
      raidProgression: tier
        ? {
            // RIO's character endpoint includes total_bosses on the tier
            // object — prefer it. The Math.max fallback is for the rare
            // case where the field is absent (it would otherwise have
            // produced wrong denominators like "9/7" for a character whose
            // highest kill count was below the tier's true boss count).
            totalBosses:
              tier.total_bosses ??
              Math.max(
                tier.normal_bosses_killed ?? 0,
                tier.heroic_bosses_killed ?? 0,
                tier.mythic_bosses_killed ?? 0,
              ),
            normalKilled: tier.normal_bosses_killed ?? 0,
            heroicKilled: tier.heroic_bosses_killed ?? 0,
            mythicKilled: tier.mythic_bosses_killed ?? 0,
          }
        : null,
    };
  } catch (e) {
    console.error("[raiderio] character core failed:", e);
    return null;
  }
}

async function _getCharacterDetail(
  realmSlug: string,
  name: string,
): Promise<CharacterDetail | null> {
  try {
    const core = await getCharacterCore(realmSlug, name);
    if (!core) return null;

    // Talents are intentionally NOT awaited here. The Profile page streams
    // them in via a separate Suspense boundary so the gear/stats/tabs render
    // immediately while talent icon resolution (~80 BNet calls cold) happens
    // in the background.
    //
    // The ~2.67MB BNet achievements blob is NOT fetched here either — it's the
    // dominant Active-CPU cost on this route (too big for Next's data cache, so
    // re-parsed on every ISR regeneration) and it's invisible on the default
    // render: the profile's AOTC/CE/HoF badges + season-title stars come from
    // the snapshot via `getCharacterBadges` (already computed by the twice-daily
    // enrichments), and the Achievements TAB lazy-loads its summary from
    // `/api/achievements` only when a visitor actually opens it. So this fanout
    // stays cheap (RIO profile + gear + stats + collections + pvp + raids).
    const [stats, collections, pvp, raidEncountersRaw] = await Promise.all([
      getCharacterStats(realmSlug, name),
      getCharacterCollections(realmSlug, name),
      getCharacterPvp(realmSlug, name),
      getCharacterRaidEncounters(realmSlug, name),
    ]);

    // Attach guild kill rosters to each encounter. We use the tier slug
    // from the character's own RIO profile (already in core) — going via
    // getGuildSnapshot here would block the streamed loadout on cold cache.
    const raidEncounters = raidEncountersRaw
      ? await attachKillRosters(raidEncountersRaw, core.currentTierSlug)
      : null;

    return {
      ...core,
      // Filled by the page from the snapshot (getCharacterBadges); the
      // compare page — the other getCharacterDetail consumer — doesn't read
      // these, so leaving them empty here is safe.
      seasonTitles: [],
      stats,
      achievements: null,
      tierBadges: null,
      collections,
      pvp,
      talents: null,
      raidEncounters,
    };
  } catch (e) {
    console.error("[raiderio] character detail failed:", e);
    return null;
  }
}

type RioRun = {
  dungeon: string;
  short_name: string;
  mythic_level: number;
  completed_at: string;
  clear_time_ms: number;
  par_time_ms: number;
  num_keystone_upgrades: number;
  score: number;
  icon_url: string;
  url: string;
};

type RioRank = { world?: number; region?: number; realm?: number };
type RioRanksFull = {
  class?: RioRank;
  class_tank?: RioRank;
  class_healer?: RioRank;
  class_dps?: RioRank;
};

function pickClassRoleRank(
  ranks: RioRanksFull | undefined,
  role: Role,
): RioRank | undefined {
  if (!ranks) return undefined;
  const key =
    role === "tank"
      ? "class_tank"
      : role === "healer"
      ? "class_healer"
      : "class_dps";
  const specific = ranks[key];
  // If the role-specific rank is missing or zero, fall back to all-class rank.
  if (specific && (specific.realm ?? 0) > 0) return specific;
  return ranks.class;
}

type RioGearItem = {
  item_id: number;
  name: string;
  item_level: number;
  icon: string;
  item_quality: number;
  bonuses?: number[];
  gems?: number[];
  enchants?: number[];
};

const GEAR_SLOT_ORDER = [
  "head",
  "neck",
  "shoulder",
  "back",
  "chest",
  "wrist",
  "hands",
  "waist",
  "legs",
  "feet",
  "finger1",
  "finger2",
  "trinket1",
  "trinket2",
  "mainhand",
  "offhand",
];

/**
 * Compute equipped item level the way WoW shows it on the character sheet:
 * sum over the 16 equip slots, divided by 16. For 2H / ranged wielders the
 * mainhand counts double (occupies both mainhand and the phantom offhand).
 *
 * Needed because RIO's `gear.item_level_equipped` is wrong for 2H wielders:
 * it just sums the items it returns and divides by the count, so a DK or BM
 * Hunter with 15 items gets sum/15 instead of (sum+mainhand)/16. The result
 * is an integer when the sum is divisible by 15, which is why ~half the
 * tank/2H roster surfaced as integer ilvls while 1H+shield wielders got
 * proper fractions.
 *
 * Shirt + tabard are intentionally excluded — they don't count in-game.
 */
function computeEquippedIlvl(
  items: Record<string, { item_level?: number }> | undefined,
): number | undefined {
  if (!items) return undefined;
  let sum = 0;
  let mainhandIlvl: number | undefined;
  let hasOffhand = false;
  for (const slot of GEAR_SLOT_ORDER) {
    const ilvl = items[slot]?.item_level;
    if (!ilvl) continue;
    sum += ilvl;
    if (slot === "mainhand") mainhandIlvl = ilvl;
    if (slot === "offhand") hasOffhand = true;
  }
  if (sum === 0) return undefined;
  if (!hasOffhand && mainhandIlvl != null) sum += mainhandIlvl;
  return sum / 16;
}

function shapeGear(
  items: Record<string, RioGearItem> | undefined,
): GearItem[] {
  if (!items) return [];
  const out: GearItem[] = [];
  for (const slot of GEAR_SLOT_ORDER) {
    const item = items[slot];
    if (!item || !item.name) continue;
    out.push({
      slot,
      itemId: item.item_id,
      name: item.name,
      itemLevel: item.item_level,
      iconUrl: `https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg`,
      quality: item.item_quality,
      bonuses: item.bonuses ?? [],
      gems: item.gems ?? [],
      enchants: item.enchants ?? [],
    });
  }
  return out;
}

function latestRunTimestamp(runs: RioRun[]): number {
  let max = 0;
  for (const r of runs) {
    const t = new Date(r.completed_at).getTime();
    if (t > max) max = t;
  }
  return max;
}

function shapeRun(r: RioRun): MythicPlusRun {
  return {
    dungeon: r.dungeon,
    shortName: r.short_name,
    level: r.mythic_level,
    completedAt: r.completed_at,
    clearTimeMs: r.clear_time_ms,
    parTimeMs: r.par_time_ms,
    upgrades: r.num_keystone_upgrades,
    score: r.score,
    iconUrl: r.icon_url,
    url: r.url,
  };
}

// raider.io's website root (no /v1) hosts internal endpoints we lean on
// for full season run history. Public for browsers but undocumented.
const RIO_INTERNAL_BASE = "https://raider.io/api";
const RIO_CURRENT_SEASON = "season-mn-1";

/** Look up raider.io's internal numeric character id for a guildie. We
 *  cache the result in snapshot.json so this only fires once per character
 *  ever (ids don't change). */
async function fetchRioCharacterId(
  realm: string,
  name: string,
): Promise<number | null> {
  const url =
    `${RIO_INTERNAL_BASE}/characters/${GUILD.region.toLowerCase()}/` +
    `${slugifyRealm(realm)}/${encodeURIComponent(name)}` +
    `?season=${RIO_CURRENT_SEASON}`;
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const data = await res.json();
    const json = JSON.stringify(data);
    // The id is nested inside characterDetails.character; regex out the
    // first one paired with a persona_id (the character object's pair).
    const m = json.match(/"id":(\d{6,}),"persona_id":\d+/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

/** All TIMED runs at +12 or higher for a character. Iterates raider.io's
 *  internal mythic-plus-runs endpoint PER DUNGEON via `dungeonId` filter
 *  — this is the only known way to escape the per-query cap. Role-based
 *  filtering caps at ~10 runs total across the season; per-dungeon caps
 *  at ~25+ runs PER dungeon, which is enough season history to find the
 *  actual earliest timed +X timestamp per dungeon (required for accurate
 *  Resilient earnedAt).
 *
 *  Steps:
 *    1. Hit the scored-runs endpoint once to discover the 8 active-season
 *       dungeons + their numeric IDs.
 *    2. Fan out 8 parallel calls, one per dungeonId, requesting timed runs.
 *    3. Dedupe by keystone_run_id; filter to level >= 12. */
async function fetchAllRoleRunsAtLeast12(
  charId: number,
): Promise<MythicPlusRun[]> {
  type WrappedRun = {
    summary: {
      dungeon: { short_name: string; id?: number };
      keystone_run_id: number;
      mythic_level: number;
      completed_at: string;
      clear_time_ms: number;
      keystone_time_ms?: number;
      num_chests: number;
    };
    score?: number;
  };
  type ScoredEntry = {
    dungeon: { id: number; short_name: string };
  };

  // Step 1: discover active dungeon IDs for this character.
  const dungeonIds: number[] = [];
  try {
    const scoredUrl =
      `${RIO_INTERNAL_BASE}/characters/mythic-plus-scored-runs` +
      `?season=${RIO_CURRENT_SEASON}&role=all&mode=scored&affixes=all` +
      `&date=all&characterId=${charId}`;
    const res = await fetch(scoredUrl, {
      next: { revalidate: REVALIDATE.guild },
    });
    if (res.ok) {
      const data = (await res.json()) as { dungeons?: ScoredEntry[] };
      for (const d of data.dungeons ?? []) {
        if (d.dungeon?.id) dungeonIds.push(d.dungeon.id);
      }
    }
  } catch {
    /* best-effort */
  }
  if (dungeonIds.length === 0) return [];

  // Step 2: fan out per-dungeon timed runs.
  const out = new Map<number, MythicPlusRun>();
  await Promise.all(
    dungeonIds.map(async (dId) => {
      const url =
        `${RIO_INTERNAL_BASE}/characters/mythic-plus-runs` +
        `?season=${RIO_CURRENT_SEASON}&characterId=${charId}` +
        `&role=all&mode=timed&affixes=all&date=all&dungeonId=${dId}`;
      try {
        const res = await fetch(url, {
          next: { revalidate: REVALIDATE.guild },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { runs?: WrappedRun[] };
        for (const wrap of data.runs ?? []) {
          const s = wrap.summary;
          if (s.mythic_level < 12) continue;
          if (s.num_chests < 1) continue; // timed only
          if (out.has(s.keystone_run_id)) continue;
          out.set(s.keystone_run_id, {
            dungeon: s.dungeon.short_name,
            shortName: s.dungeon.short_name,
            level: s.mythic_level,
            completedAt: s.completed_at,
            clearTimeMs: s.clear_time_ms,
            parTimeMs: s.keystone_time_ms ?? 0,
            upgrades: s.num_chests,
            score: wrap.score ?? 0,
            iconUrl: "",
            url: "",
          });
        }
      } catch {
        /* best-effort; one failed dungeon doesn't sink the whole fetch */
      }
    }),
  );
  return [...out.values()];
}

/**
 * Read the RIO username that has claimed this character, if any.
 *
 * Hits raider.io's internal (undocumented) character endpoint, which returns
 * a much richer payload than the public `/api/v1/characters/profile` and
 * includes a `user.name` field when the character has been claimed. That
 * field is the only character→user reverse-lookup RIO exposes publicly —
 * the public API and the guild roster strip it out, and the per-character
 * `/alts` endpoint is auth-gated to the owner's own session.
 *
 * Used by the snapshot builder to auto-derive alt groupings in TopPerformers
 * — characters sharing a `claimedOwner` are the same player. Returns `null`
 * silently for unclaimed characters and on any transport/parse error, since
 * the manual ALT_GROUPS in config.ts is the documented fallback.
 *
 * Best-effort: no retries. A miss only costs us auto-grouping for one
 * character on one snapshot pass; the next snapshot rebuild will pick it
 * back up.
 */
async function fetchClaimedOwner(
  realmSlug: string,
  name: string,
): Promise<string | null> {
  const url =
    `https://raider.io/api/characters/${GUILD.region}/${realmSlug}/` +
    encodeURIComponent(name);
  // Retry transient failures (network, 5xx, or a non-JSON throttle/SPA page).
  // Without this, the ~per-roster burst of claim lookups drops owners on the
  // occasional flake — and since this is the bootstrap for warband alt grouping,
  // one miss on an active main loses the whole group for that build. A 4xx is
  // definitive ("no such character") and a 200 with no user is a real "no public
  // owner" — neither retries.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        next: { revalidate: REVALIDATE.guild },
        headers: {
          // The internal endpoint requires browser-shaped headers — Accept:
          // application/json alone gets the SPA shell HTML back.
          "User-Agent":
            "Mozilla/5.0 (compatible; LIB-site-snapshot/1.0; +https://lib-site.vercel.app)",
          Accept: "application/json",
          Referer: "https://raider.io/",
        },
      });
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("json")) {
          // The user info lives at characterDetails.user.name — the top-level
          // response is `{ characterRaidProgress, characterMythicPlusProgress,
          // characterDetails }`, not a flat character object.
          const body = (await res.json()) as {
            characterDetails?: { user?: { name?: string } | null } | null;
          };
          const owner = body?.characterDetails?.user?.name;
          return typeof owner === "string" && owner.length > 0 ? owner : null;
        }
        // non-JSON (throttle / SPA shell) — transient, fall through to retry
      } else if (res.status < 500) {
        return null; // 4xx is definitive
      }
    } catch {
      // network error — fall through to retry
    }
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return null;
}

/**
 * RIO's public warband endpoint: every character a claimed user owns, when
 * their RIO profile is public. The per-character claim lookup (fetchClaimedOwner)
 * only resolves a character RIO has re-crawled since it was claimed — and a
 * profile-visibility flip does NOT trigger a re-crawl — so a warband's
 * less-active alts lag behind its actively-played main. Given one known owner,
 * this returns the whole warband in a single call, letting backfillWarbandOwners
 * stamp the laggards. Returns [] for a private/unknown user or any error.
 */
async function fetchWarbandMembers(
  userName: string,
): Promise<{ name: string; realmSlug: string }[]> {
  const url =
    `https://raider.io/api/user/view-characters?name=` +
    encodeURIComponent(userName);
  try {
    const res = await fetch(url, {
      next: { revalidate: REVALIDATE.guild },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LIB-site-snapshot/1.0; +https://lib-site.vercel.app)",
        Accept: "application/json",
        Referer: "https://raider.io/",
      },
    });
    if (!res.ok) return [];
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return [];
    const body = (await res.json()) as {
      viewUserCharactersApi?: {
        characters?: {
          character?: { name?: string; realm?: { slug?: string } | null };
        }[];
      } | null;
    };
    const chars = body?.viewUserCharactersApi?.characters ?? [];
    const out: { name: string; realmSlug: string }[] = [];
    for (const c of chars) {
      const name = c?.character?.name;
      const slug = c?.character?.realm?.slug;
      // Match roster names, which are fixMojibake'd on ingest.
      if (name && slug) out.push({ name: fixMojibake(name), realmSlug: slug });
    }
    return out;
  } catch {
    return [];
  }
}

const WARBAND_CONCURRENCY = 4;

/**
 * Backfill claimedOwner for warband alts the per-character claim lookup missed.
 * Collect the owners we already know (from characters RIO has re-crawled), pull
 * each owner's full warband once via the public view-characters endpoint, and
 * stamp that owner onto any still-unresolved roster character in the warband.
 * One re-crawled character per warband is enough for the whole group to
 * converge — so alt grouping in Top Performers self-heals automatically (no
 * manual config), instead of waiting for RIO to re-crawl every alt. Best-effort
 * and bounded: ~one extra call per distinct owner (about a dozen), each cached
 * by Next for REVALIDATE.guild; private/unknown owners are simply skipped.
 */
async function backfillWarbandOwners(
  enriched: EnrichedCharacter[],
): Promise<void> {
  const owners = new Set<string>();
  for (const e of enriched) {
    const o = e.character.claimedOwner;
    if (o) owners.add(o);
  }
  if (owners.size === 0) return;

  // member key (realmSlug:nameLc) -> owning RIO user, across all known warbands.
  const memberToOwner = new Map<string, string>();
  await mapWithConcurrency([...owners], WARBAND_CONCURRENCY, async (owner) => {
    const members = await fetchWarbandMembers(owner);
    for (const m of members) {
      memberToOwner.set(
        `${m.realmSlug.toLowerCase()}:${m.name.toLowerCase()}`,
        owner,
      );
    }
  });
  if (memberToOwner.size === 0) return;

  for (const e of enriched) {
    if (e.character.claimedOwner) continue;
    const key = `${e.character.realmSlug.toLowerCase()}:${e.character.name.toLowerCase()}`;
    const owner = memberToOwner.get(key);
    if (owner) e.character.claimedOwner = owner;
  }
}

async function fetchCharacterProfile(
  realm: string,
  name: string,
): Promise<RioCharacterProfile | null> {
  const url =
    `${RIO_BASE}/characters/profile?region=${GUILD.region}` +
    `&realm=${slugifyRealm(realm)}` +
    `&name=${encodeURIComponent(name)}` +
    `&fields=gear,mythic_plus_scores_by_season:current,mythic_plus_ranks,raid_progression,mythic_plus_recent_runs,mythic_plus_weekly_highest_level_runs,mythic_plus_best_runs:all,mythic_plus_alternate_runs:all,mythic_plus_highest_level_runs,mythic_plus_previous_weekly_highest_level_runs`;
  // Retry transient RIO failures up to 4 times. Honors Retry-After on 429
  // (RIO's rate-limit response) and backs off exponentially on 5xx /
  // network errors. One bad response would otherwise poison a snapshot
  // for the full 1h cache duration, leaving characters with stub data.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        next: { revalidate: REVALIDATE.guild },
      });
      if (res.ok) return res.json();
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10);
        const wait = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 1000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      // 4xx other than 429 won't recover — don't waste retries.
      if (res.status < 500) return null;
    } catch {
      // network error — fall through to retry
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return null;
}

function slugifyRealm(realm: string): string {
  return realm
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/\s+/g, "-");
}

async function fetchGuild(): Promise<RioGuildResponse> {
  const url =
    `${RIO_BASE}/guilds/profile?region=${GUILD.region}` +
    `&realm=${GUILD.realm}` +
    `&name=${encodeURIComponent(GUILD.name)}` +
    `&fields=raid_progression,raid_rankings,members`;
  const res = await fetch(url, { next: { revalidate: REVALIDATE.guild } });
  if (!res.ok) throw new Error(`Raider.IO guild ${res.status}`);
  return res.json();
}

type RaidMeta = {
  slug: string;
  expansionId: number;
  expansionName: string;
  /** Earliest US release timestamp of the raid in this listing, ms since epoch. 0 if unknown. */
  releasedAt: number;
  iconUrl?: string;
};

const EXPANSION_NAMES: Record<number, string> = {
  20: "Future",
  19: "Future",
  18: "Future",
  17: "Future",
  16: "Future",
  15: "Future",
  14: "Future",
  13: "Future",
  12: "Future",
  11: "Midnight",
  10: "The War Within",
  9: "Dragonflight",
  8: "Shadowlands",
  7: "Battle for Azeroth",
  6: "Legion",
  5: "Warlords of Draenor",
  4: "Mists of Pandaria",
  3: "Cataclysm",
  2: "Wrath of the Lich King",
  1: "The Burning Crusade",
  0: "Classic",
};

// Raids before Legion aren't in Raider.IO's static-data, but BNet still
// returns "Guild Run" achievements for them. Hardcoding name → expansion +
// boss count lets raid history go back as far as the guild's achievement
// log. Slug is intentionally empty: we can't link to /progression/raid/[slug]
// because RIO has no kill data for these. Counts cover full raid sizes;
// difficulty is inferred from achievement name as usual.
const PRE_LEGION_RAIDS: Record<
  string,
  { expansionId: number; totalBosses: number }
> = {
  // Warlords of Draenor (5)
  Highmaul: { expansionId: 5, totalBosses: 7 },
  "Blackrock Foundry": { expansionId: 5, totalBosses: 10 },
  "Hellfire Citadel": { expansionId: 5, totalBosses: 13 },
  // Mists of Pandaria (4)
  "Mogu'shan Vaults": { expansionId: 4, totalBosses: 6 },
  "Heart of Fear": { expansionId: 4, totalBosses: 6 },
  "Terrace of Endless Spring": { expansionId: 4, totalBosses: 4 },
  "Throne of Thunder": { expansionId: 4, totalBosses: 12 },
  "Siege of Orgrimmar": { expansionId: 4, totalBosses: 14 },
  // Cataclysm (3)
  "Baradin Hold": { expansionId: 3, totalBosses: 3 },
  "Blackwing Descent": { expansionId: 3, totalBosses: 6 },
  "The Bastion of Twilight": { expansionId: 3, totalBosses: 5 },
  "Throne of the Four Winds": { expansionId: 3, totalBosses: 2 },
  Firelands: { expansionId: 3, totalBosses: 7 },
  "Dragon Soul": { expansionId: 3, totalBosses: 8 },
  // Wrath of the Lich King (2) — Guild Run achievements were introduced in
  // Cataclysm, so Wrath raids only show up if the guild ran them via WotLK
  // Classic. Listing for completeness.
  Naxxramas: { expansionId: 2, totalBosses: 15 },
  "The Eye of Eternity": { expansionId: 2, totalBosses: 1 },
  "The Obsidian Sanctum": { expansionId: 2, totalBosses: 1 },
  "Vault of Archavon": { expansionId: 2, totalBosses: 4 },
  Ulduar: { expansionId: 2, totalBosses: 14 },
  "Trial of the Crusader": { expansionId: 2, totalBosses: 5 },
  "Onyxia's Lair": { expansionId: 2, totalBosses: 1 },
  "Icecrown Citadel": { expansionId: 2, totalBosses: 12 },
  "The Ruby Sanctum": { expansionId: 2, totalBosses: 1 },
};

let knownRaidsCache: { value: Map<string, RaidMeta>; expiresAt: number } | null =
  null;

async function getKnownRaids(): Promise<Map<string, RaidMeta>> {
  if (knownRaidsCache && knownRaidsCache.expiresAt > Date.now()) {
    return knownRaidsCache.value;
  }
  // Fetch all expansions in parallel, then merge oldest-first so re-listed
  // ("Fated"/"Awakened") raids stay attributed to their original expansion.
  type StaticRaid = {
    name: string;
    slug: string;
    starts?: { us?: string };
    icon?: string;
  } & RioRaid;
  const ids = Object.keys(EXPANSION_NAMES)
    .map(Number)
    .sort((a, b) => a - b);
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const url = `${RIO_BASE}/raiding/static-data?expansion_id=${id}`;
        const res = await fetch(url, {
          next: { revalidate: REVALIDATE.raidStatic },
        });
        if (!res.ok) return { id, raids: [] as StaticRaid[] };
        const data: RioStaticData = await res.json();
        return {
          id,
          raids: (data.raids ?? []).filter(
            (r): r is StaticRaid => !!r.name,
          ),
        };
      } catch {
        return { id, raids: [] as StaticRaid[] };
      }
    }),
  );
  const raids = new Map<string, RaidMeta>();
  for (const result of results) {
    const expansionName = EXPANSION_NAMES[result.id] ?? `Expansion ${result.id}`;
    for (const raid of result.raids) {
      if (raids.has(raid.name)) continue;
      const releasedAt = raid.starts?.us
        ? new Date(raid.starts.us).getTime()
        : 0;
      raids.set(raid.name, {
        slug: raid.slug,
        expansionId: result.id,
        expansionName,
        releasedAt,
        iconUrl: raid.icon
          ? `https://wow.zamimg.com/images/wow/icons/large/${raid.icon}.jpg`
          : undefined,
      });
    }
  }
  // Stamp pre-Legion raids that RIO doesn't index, so BNet "Guild Run"
  // achievements for them still appear in raid history. Slug is empty —
  // /progression page renders these as non-clickable rows.
  for (const [name, meta] of Object.entries(PRE_LEGION_RAIDS)) {
    if (raids.has(name)) continue;
    raids.set(name, {
      slug: "",
      expansionId: meta.expansionId,
      expansionName:
        EXPANSION_NAMES[meta.expansionId] ?? `Expansion ${meta.expansionId}`,
      releasedAt: 0,
    });
  }

  // Backfill missing iconUrls from BNet's journal-instance media (raid
  // tiles). Pre-Legion raids and any RIO entry missing `icon` get a wide
  // raid banner pulled from BNet. Cached aggressively in battlenet.ts.
  const needIcon = [...raids.entries()].filter(([, m]) => !m.iconUrl);
  await Promise.all(
    needIcon.map(async ([name, meta]) => {
      const tileUrl = await getRaidTileUrlByName(name).catch(() => null);
      if (tileUrl) raids.set(name, { ...meta, iconUrl: tileUrl });
    }),
  );

  knownRaidsCache = {
    value: raids,
    expiresAt: Date.now() + 12 * 3600 * 1000,
  };
  return raids;
}

async function fetchRaidMeta(slug: string): Promise<RioRaid | null> {
  // Scan from newest plausible expansion down through Legion (id 6).
  // This auto-rolls when new expansions launch — Raider.IO assigns sequential
  // IDs and old expansions stay reachable. Older expansions (TBC/Wrath/etc.)
  // aren't in RIO's static-data so we don't bother scanning below 6.
  const expansionIds = [
    20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6,
  ];
  for (const expansionId of expansionIds) {
    try {
      const url = `${RIO_BASE}/raiding/static-data?expansion_id=${expansionId}`;
      const res = await fetch(url, {
        next: { revalidate: REVALIDATE.raidStatic },
      });
      if (!res.ok) continue;
      const data: RioStaticData = await res.json();
      const match = data.raids?.find((r) => r.slug === slug);
      if (match) return match;
    } catch {
      // continue
    }
  }
  return null;
}

function pickCurrentTierSlug(guild: RioGuildResponse): string | null {
  const slugs = Object.keys(guild.raid_progression ?? {});
  return slugs[0] ?? null;
}

type RioTierProgression = {
  total_bosses?: number;
  normal_bosses_killed?: number;
  heroic_bosses_killed?: number;
  mythic_bosses_killed?: number;
};

/** Pick the character's CURRENT tier entry from RIO's raid_progression.
 *
 *  RIO orders a character's raid_progression differently from a guild's: the
 *  character endpoint sometimes lists an upcoming / placeholder raid (e.g. a
 *  1-boss "sporefall" with zero kills) FIRST. The old code took [0] blindly,
 *  so the character sheet's "Current Tier Progress" rendered "0/1" even when
 *  the real tier was well underway (the guild endpoint lists the real tier
 *  first, which is why the homepage was unaffected).
 *
 *  Fix: match the guild's known current tier slug (from the bundled snapshot,
 *  e.g. "tier-mn-1"). If that key isn't present in this character's
 *  progression, fall back to the most-progressed entry, then the one with the
 *  most bosses — never a 0-kill 1-boss placeholder when a real tier exists. */
function pickCharacterCurrentTier(
  raidProgression: Record<string, RioTierProgression> | undefined,
): { slug: string; tier: RioTierProgression } | null {
  const entries = Object.entries(raidProgression ?? {});
  if (entries.length === 0) return null;
  const currentSlug = bundledFile.snapshot.tierSlug;
  const matched = currentSlug ? raidProgression?.[currentSlug] : undefined;
  if (currentSlug && matched) return { slug: currentSlug, tier: matched };
  const score = (t: RioTierProgression) =>
    (t.mythic_bosses_killed ?? 0) * 1000 +
    (t.heroic_bosses_killed ?? 0) * 100 +
    (t.normal_bosses_killed ?? 0) * 10 +
    (t.total_bosses ?? 0);
  const [bestSlug, bestTier] = entries.sort(
    ([, a], [, b]) => score(b) - score(a),
  )[0]!;
  return { slug: bestSlug, tier: bestTier };
}

/** RIO occasionally returns character names that have been double-encoded:
 *  the original UTF-8 bytes for a non-ASCII char (e.g. "ì" = 0xC3 0xAC) were
 *  decoded as Latin-1 ("Ã¬") and re-encoded as UTF-8, sometimes more than
 *  once. Detects the cascade marker chars (Ã, Â) and re-decodes through
 *  Latin-1 → UTF-8 up to three times until the name stabilizes. Safe for
 *  clean ASCII names (no markers → no-op). */
function fixMojibake(s: string): string {
  let curr = s;
  for (let iter = 0; iter < 3; iter++) {
    if (!/[À-ÿ]/.test(curr)) break;
    const bytes = new Uint8Array(curr.length);
    let valid = true;
    for (let i = 0; i < curr.length; i++) {
      const code = curr.charCodeAt(i);
      if (code > 255) {
        valid = false;
        break;
      }
      bytes[i] = code;
    }
    if (!valid) break;
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (decoded === curr) break;
      curr = decoded;
    } catch {
      break;
    }
  }
  return curr;
}

function shapeRoster(
  members: RioMember[],
): { character: Character; rank: number; lastCrawledAt?: string }[] {
  const allowed: readonly number[] = RAIDER_RANKS;
  const filtered = members.filter((m) => allowed.includes(m.rank));
  const seen = new Set<string>();
  const out: { character: Character; rank: number; lastCrawledAt?: string }[] =
    [];
  for (const m of filtered) {
    const c = m.character;
    // Dedupe on the *normalized* name so RIO's mojibake variants of the
    // same character (e.g. "GalÃ¬e" + "GalÃƒÂ¬e") collapse into one entry.
    const normalizedName = fixMojibake(c.name);
    const key = `${c.realm}-${normalizedName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const isLeader = GUILD_LEADER_CHARACTERS.some(
      (n) => n.toLowerCase() === c.name.toLowerCase(),
    );
    out.push({
      character: {
        name: fixMojibake(c.name),
        realm: c.realm,
        realmSlug: slugifyRealm(c.realm),
        class: classToKey(c.class),
        spec: c.active_spec_name,
        role: roleFromRio(c.active_spec_role),
        faction: c.faction,
        rank: rankFromRio(m.rank),
        rankNumber: m.rank,
        rankLabel: isLeader ? GUILD_LEADER_LABEL : RANK_LABELS[m.rank],
        profileUrl: c.profile_url,
        roleScores: { tank: 0, healer: 0, dps: 0 },
        achievementPoints: c.achievement_points,
      },
      rank: m.rank,
      lastCrawledAt: c.last_crawled_at,
    });
  }
  return out;
}

function classToKey(s: string): WowClass {
  const k = s.toLowerCase().replace(/\s|'/g, "");
  const map: Record<string, WowClass> = {
    deathknight: "deathknight",
    demonhunter: "demonhunter",
    druid: "druid",
    evoker: "evoker",
    hunter: "hunter",
    mage: "mage",
    monk: "monk",
    paladin: "paladin",
    priest: "priest",
    rogue: "rogue",
    shaman: "shaman",
    warlock: "warlock",
    warrior: "warrior",
  };
  return map[k] ?? "warrior";
}

function roleFromRio(r: "TANK" | "HEALING" | "DPS"): Role {
  if (r === "TANK") return "tank";
  if (r === "HEALING") return "healer";
  return "dps";
}

function rankFromRio(rank: number): Rank {
  // Only rank 0 is universal in WoW (always the GM). All other rank
  // numbers are guild-defined and we have no source for the names from
  // Raider.IO — Battle.net API would give us real rank names. Until then,
  // don't make up labels.
  return rank === 0 ? "GM" : "Member";
}
