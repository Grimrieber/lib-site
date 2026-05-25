import type {
  Affix,
  Boss,
  BossKill,
  Character,
  CharacterCore,
  CharacterDetail,
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
  Rank,
  Role,
  SeasonScore,
  SubRaid,
  TierState,
  WeeklyAffixes,
  WowClass,
} from "./types";
import {
  CURRENT_TIER_FINAL_BOSS,
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
  TIER_SUB_RAIDS,
} from "./config";
import bundledSnapshotFile from "@/data/snapshot.json";
import {
  getCharacterAchievements,
  getCharacterAvatar,
  getCharacterCollections,
  getCharacterEquipment,
  getCharacterPvp,
  getCharacterRaidEncounters,
  getCharacterStats,
  getCharacterTalents,
  getCharacterTierData,
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
 *  individual RIO partial responses into a complete roster. */
export function invalidateSnapshotCache(): void {
  snapshotCache = null;
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
      // Per-character try/catch so one BNet hiccup (rate limit, malformed
      // response on a transferred character, etc.) doesn't reject the
      // whole enrichments promise and crash the Suspense boundary.
      const tierData = await mapWithConcurrency(
        snapshot.roster,
        ENRICHMENT_CONCURRENCY,
        async (c) => {
          try {
            return await getCharacterTierData(
              c.realmSlug,
              c.name,
              CURRENT_TIER_FINAL_BOSS,
            );
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
      const enrichedRoster: Character[] = snapshot.roster.map((c, i) => ({
        ...c,
        tierBadges: tierData[i]?.tierBadges,
      }));

      // BNet's recent_events is unbounded in time — could include a
      // 2-year-old AOTC. Filter to the last 90 days so the feed shows
      // genuinely recent wins.
      const recentCutoff = Date.now() - 90 * 24 * 3600 * 1000;
      const achievements: GuildAchievement[] = [];
      for (let i = 0; i < snapshot.roster.length; i++) {
        const td = tierData[i];
        if (!td) continue;
        const c = snapshot.roster[i];
        const runner: GuildRunner = {
          name: c.name,
          realmSlug: c.realmSlug,
          class: c.class,
        };
        for (const a of td.notableRecent) {
          if (a.timestamp < recentCutoff) continue;
          achievements.push({ ...a, character: runner });
        }
      }
      achievements.sort((a, b) => b.timestamp - a.timestamp);

      const value: RosterEnrichments = {
        enrichedRoster,
        recentAchievements: achievements.slice(0, 12),
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
const stampOfficer = (c: Character): Character => ({
  ...c,
  isOfficer:
    !c.isGuildLeader &&
    !leaderCharNamesLc.has(c.name.toLowerCase()) &&
    c.rankNumber <= OFFICER_RANK_THRESHOLD,
});
const bundledSnapshot: GuildSnapshot = {
  ...bundledFile.snapshot,
  roster: bundledFile.snapshot.roster.map(stampOfficer),
};
const bundledEnrichments: RosterEnrichments = {
  enrichedRoster: bundledFile.enrichedRoster.map(stampOfficer),
  recentAchievements: bundledFile.recentAchievements,
};

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
        // Defensive filter: only backfill entries that have an avatarUrl.
        // Real RIO/BNet-enriched roster entries always have one; entries
        // without are leftover mock/test data or otherwise unenriched, and
        // we don't want them resurrected into production via the merge.
        const missing = fallback.roster.filter(
          (c) => !liveNamesLc.has(c.name.toLowerCase()) && Boolean(c.avatarUrl),
        );
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

// Opt-in pre-warm: walks the roster and pre-fetches each character's full
// detail into the module cache so subsequent user clicks hit cache. Not
// auto-triggered from getGuildSnapshot() because under cold-cache conditions
// the BNet fanout (50 chars × 7 calls each) starves user-facing requests.
// Intended to be called from a dedicated endpoint (e.g. Vercel cron at
// /api/refresh) where running it in the background is appropriate.
//
// Concurrency is intentionally low (3) so when this runs alongside live
// traffic, ongoing user requests still get a fair share of BNet bandwidth.
let warmupInFlight: Promise<void> | null = null;
export async function warmupCharacterDetails(): Promise<void> {
  if (warmupInFlight) return warmupInFlight;
  const concurrency = 3;
  warmupInFlight = (async () => {
    try {
      const snapshot = await getGuildSnapshot();
      if (snapshot.source !== "raiderio") return;
      const queue = [...snapshot.roster];
      const workers = Array.from({ length: concurrency }, async () => {
        while (queue.length) {
          const c = queue.shift();
          if (!c) return;
          await getCharacterDetail(c.realmSlug, c.name).catch(() => null);
        }
      });
      await Promise.all(workers);
    } finally {
      warmupInFlight = null;
    }
  })();
  return warmupInFlight;
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
    const active = activeEnriched.map(({ character, lastRunAt }) => {
      const nameLc = character.name.toLowerCase();
      const isLeader = leaderPins.has(nameLc);
      return {
        ...character,
        lastRunAt,
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
    const weeklyTopRuns = topRunsThisWeek(allRuns, 12, getLastUSResetMs());

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
        name: r.character.name.replace(/-\d+$/, ""),
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
  gear?: { item_level_equipped?: number };
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
      normal_bosses_killed?: number;
      heroic_bosses_killed?: number;
      mythic_bosses_killed?: number;
    }
  >;
  mythic_plus_recent_runs?: RioRun[];
};

type CharKills = { normal: number; heroic: number; mythic: number };
type EnrichedCharacter = {
  character: Character;
  kills: CharKills;
  rank: number;
  recentRuns: MythicPlusRun[];
  /** Unix ms timestamp of most recent M+ run, 0 if none */
  lastRunAt: number;
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
    `&fields=gear,${SEASON_FIELD},mythic_plus_ranks,raid_progression,mythic_plus_recent_runs`;
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
  const tier = Object.values(p.raid_progression ?? {})[0];
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
  return {
    character: {
      name: p.name,
      realm: p.realm,
      realmSlug,
      class: classToKey(p.class),
      spec: p.active_spec_name,
      role,
      faction: p.faction,
      ilvl: p.gear?.item_level_equipped,
      mythicPlusScore: score,
      mythicPlusScoreColor:
        color && color !== "#ffffff" ? color : undefined,
      roleScores,
      realmClassRank: roleRank?.realm,
      avatarUrl,
      profileUrl: p.profile_url,
      rank: "Member",
      rankNumber: 9,
    },
    kills,
    rank: 9,
    recentRuns: (p.mythic_plus_recent_runs ?? []).map(shapeRun),
    lastRunAt: latestRunTimestamp(p.mythic_plus_recent_runs ?? []),
  };
}

async function enrichRoster(
  members: { character: Character; rank: number }[],
): Promise<EnrichedCharacter[]> {
  return mapWithConcurrency(members, ENRICHMENT_CONCURRENCY, async (m) => {
    const { character: c, rank } = m;
    const profile = await fetchCharacterProfile(c.realm, c.name);
    const empty: CharKills = { normal: 0, heroic: 0, mythic: 0 };
    const zeroScores = { tank: 0, healer: 0, dps: 0 };
    if (!profile)
      return {
        character: { ...c, roleScores: zeroScores },
        kills: empty,
        rank,
        recentRuns: [],
        lastRunAt: 0,
      };
    const season = profile.mythic_plus_scores_by_season?.[0];
    const score = season?.segments?.all?.score ?? season?.scores?.all ?? 0;
    const color = season?.segments?.all?.color;
    const roleScores = {
      tank: season?.scores?.tank ?? 0,
      healer: season?.scores?.healer ?? 0,
      dps: season?.scores?.dps ?? 0,
    };
    const tier = Object.values(profile.raid_progression ?? {})[0];
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
    return {
      character: {
        ...c,
        ilvl: profile.gear?.item_level_equipped,
        mythicPlusScore: score,
        mythicPlusScoreColor:
          color && color !== "#ffffff" ? color : undefined,
        roleScores,
        realmClassRank: roleRank?.realm,
        avatarUrl,
      },
      kills,
      rank,
      recentRuns: (profile.mythic_plus_recent_runs ?? []).map(shapeRun),
      lastRunAt: latestRunTimestamp(profile.mythic_plus_recent_runs ?? []),
    };
  });
}

function collectAllRuns(enriched: EnrichedCharacter[]): GuildRun[] {
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
    for (const run of e.recentRuns) {
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
const CHARACTER_DETAIL_TTL_MS = 60 * 60 * 1000; // 1h

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
const CHARACTER_CORE_TTL_MS = 60 * 60 * 1000; // 1h

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
    const tier = Object.values(p.raid_progression ?? {})[0];
    const tierSlug = Object.keys(p.raid_progression ?? {})[0];
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
      // BNet's equipped gear wins when available (canonical, current);
      // fall back to RIO's potentially-stale gear/ilvl when BNet's
      // fetch failed or the response was empty.
      ilvl: bnetEquip?.ilvl ?? p.gear?.item_level_equipped,
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
            totalBosses: tier.normal_bosses_killed
              ? Math.max(
                  tier.normal_bosses_killed,
                  tier.heroic_bosses_killed ?? 0,
                  tier.mythic_bosses_killed ?? 0,
                )
              : 0,
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
    const [
      stats,
      achievements,
      tierData,
      collections,
      pvp,
      raidEncountersRaw,
    ] = await Promise.all([
      getCharacterStats(realmSlug, name),
      getCharacterAchievements(realmSlug, name),
      getCharacterTierData(realmSlug, name, CURRENT_TIER_FINAL_BOSS),
      getCharacterCollections(realmSlug, name),
      getCharacterPvp(realmSlug, name),
      getCharacterRaidEncounters(realmSlug, name),
    ]);
    const tierBadges = tierData?.tierBadges ?? null;

    // Attach guild kill rosters to each encounter. We use the tier slug
    // from the character's own RIO profile (already in core) — going via
    // getGuildSnapshot here would block the streamed loadout on cold cache.
    const raidEncounters = raidEncountersRaw
      ? await attachKillRosters(raidEncountersRaw, core.currentTierSlug)
      : null;

    return {
      ...core,
      stats,
      achievements,
      tierBadges,
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

async function fetchCharacterProfile(
  realm: string,
  name: string,
): Promise<RioCharacterProfile | null> {
  const url =
    `${RIO_BASE}/characters/profile?region=${GUILD.region}` +
    `&realm=${slugifyRealm(realm)}` +
    `&name=${encodeURIComponent(name)}` +
    `&fields=gear,mythic_plus_scores_by_season:current,mythic_plus_ranks,raid_progression,mythic_plus_recent_runs`;
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

function shapeRoster(
  members: RioMember[],
): { character: Character; rank: number }[] {
  const allowed: readonly number[] = RAIDER_RANKS;
  const filtered = members.filter((m) => allowed.includes(m.rank));
  const seen = new Set<string>();
  const out: { character: Character; rank: number }[] = [];
  for (const m of filtered) {
    const c = m.character;
    const key = `${c.realm}-${c.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isLeader = GUILD_LEADER_CHARACTERS.some(
      (n) => n.toLowerCase() === c.name.toLowerCase(),
    );
    out.push({
      character: {
        name: c.name,
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
      },
      rank: m.rank,
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

export function highestProgress(tiers: TierState[]): TierState | null {
  // Returns the highest difficulty tier with at least 1 kill, else the highest difficulty.
  const order: Difficulty[] = ["Mythic", "Heroic", "Normal"];
  for (const d of order) {
    const t = tiers.find((x) => x.difficulty === d);
    if (t && t.killed > 0) return t;
  }
  return tiers[0] ?? null;
}

export function inProgressTier(tiers: TierState[]): TierState | null {
  // The tier currently being progged: the lowest difficulty above "all killed"
  // that has kills but isn't full clear, OR the difficulty above the last cleared one.
  const order: Difficulty[] = ["Mythic", "Heroic", "Normal"];
  for (const d of order) {
    const t = tiers.find((x) => x.difficulty === d);
    if (t && t.killed > 0 && t.killed < t.totalBosses) return t;
  }
  return highestProgress(tiers);
}
