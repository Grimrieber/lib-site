export type Faction = "alliance" | "horde";

export type WowClass =
  | "deathknight"
  | "demonhunter"
  | "druid"
  | "evoker"
  | "hunter"
  | "mage"
  | "monk"
  | "paladin"
  | "priest"
  | "rogue"
  | "shaman"
  | "warlock"
  | "warrior";

export type Role = "tank" | "healer" | "dps";
export type Difficulty = "Normal" | "Heroic" | "Mythic";
export type Rank = "GM" | "Officer" | "Raider" | "Member" | "Trial";

export type Character = {
  name: string;
  realm: string;
  /** URL-friendly realm slug for internal routes */
  realmSlug: string;
  class: WowClass;
  spec: string;
  role: Role;
  faction: Faction;
  ilvl?: number;
  /** Highest equipped item level ever observed for this character across
   *  snapshot rebuilds. Avoids dips from PvP gear swaps, leveling alts,
   *  or temporary off-spec sets — the player's "best loadout" stat sticks
   *  even if they're currently in something lower. Computed at snapshot
   *  build as `max(currentReading, previousSnapshot.peakIlvl)` per
   *  character, where currentReading = `max(rioIlvl, bnetIlvl)` rounded.
   *  Drives the home page "Top iLvl" ranking. */
  peakIlvl?: number;
  /** Unix ms timestamp when `peakIlvl` was first reached. Advances only
   *  when current beats the prior peak (equal current keeps the old
   *  timestamp). Lets the UI surface "Peak 290 (3 days ago)" when desired. */
  peakIlvlAt?: number;
  mythicPlusScore?: number;
  /** Hex color RIO assigns to the score — green for high, white for low */
  mythicPlusScoreColor?: string;
  /**
   * Per-role M+ scores from RIO. A character who switched specs mid-season
   * will have non-zero values in multiple roles; the leaderboard buckets by
   * highest of these, not by the currently active spec.
   */
  roleScores: { tank: number; healer: number; dps: number };
  /**
   * Current-tier prestige badges (AOTC / Cutting Edge / Hall of Fame).
   * Populated during roster enrichment from the BNet achievements endpoint.
   */
  tierBadges?: RaidTierBadges;
  /** Best per-class realm rank across roles (lower = better) */
  realmClassRank?: number;
  rank: Rank;
  /** Raw numeric rank (0 = GM, higher = lower in guild). */
  rankNumber: number;
  /** Custom guild rank label from RANK_LABELS, if configured. */
  rankLabel?: string;
  profileUrl?: string;
  avatarUrl?: string;
  /** Timestamp (ms since epoch) of the character's most recent Mythic+ run.
   *  Used by the roster to surface "active this week" raiders. 0 = no runs. */
  lastRunAt?: number;
  /** True for the highest-scoring character in each GUILD_LEADER_GROUPS
   *  bucket — the active main of a guild leader. Drives the "Guild Leader"
   *  badge on the roster grid, replacing the rank-0 GM badge that used to
   *  surface parked alts. */
  isGuildLeader?: boolean;
  /** True when the character's rankNumber is at or above the OFFICER_RANK_THRESHOLD
   *  and they aren't already a guild leader. Drives the "Officer" badge
   *  on the roster grid and the Officers section on the About page. */
  isOfficer?: boolean;
  /** Manual role override from ROSTER_PINS. Forces this character into a
   *  specific role column on TopPerformers + the roster regardless of
   *  what their M+ score split or RIO active spec says. Set on snapshot
   *  build from the matching ROSTER_PINS entry's `role` field. */
  roleOverride?: Role;
  /** RIO username that owns this character, when the player has claimed it
   *  on raider.io. Sourced from the internal `/api/characters/{r}/{r}/{c}`
   *  endpoint's `user.name` field during enrichment. Drives the auto-detect
   *  alt grouping in TopPerformers — characters sharing a `claimedOwner`
   *  are the same player. Absent for unclaimed characters; those fall back
   *  to the manual `ALT_GROUPS` in lib/config.ts. */
  claimedOwner?: string;
};

export type GuildRunner = {
  name: string;
  realmSlug: string;
  class: WowClass;
};

export type GuildRun = MythicPlusRun & {
  /**
   * Every guildy participant in this run. RIO returns each character's own
   * `recent_runs` list, so a 5-person key with 3 guildies appears once per
   * guildy in the raw data — we collapse them into a single row with all
   * three names listed here. First entry is the "primary" runner for
   * single-name UI (e.g. RecentRunsFeed).
   */
  runners: GuildRunner[];
};

/** A single character's best keys since the weekly reset, used by
 *  WeeklyKeysFeed to render one card per character instead of a flat
 *  score-sorted list (which gets monopolized by 1-2 high pushers). */
export type CharacterWeeklyKeys = {
  runner: GuildRunner;
  /** Top runs for this character this week, score-desc. */
  runs: GuildRun[];
  /** Score of the character's #1 key — used to sort cards. */
  topScore: number;
};

export type Boss = {
  name: string;
  slug: string;
  /** Creature portrait from BNet (render.worldofwarcraft.com), if resolved */
  iconUrl?: string;
};

/**
 * A "tier" can ship as multiple raids released together (e.g. Midnight Tier 1
 * = Voidspire + Dreamrift + March on Quel'Danas). When that's the case, the
 * snapshot pre-splits the boss list into sub-raids so the UI can group them.
 * For single-raid tiers this is empty/absent and the bosses render as a flat
 * list under the tier banner.
 */
export type SubRaid = {
  name: string;
  /** Banner image (BNet instance tile), if resolved. */
  iconUrl?: string;
  /** Bosses in this sub-raid, in display order. Subset of TierState.bosses. */
  bosses: Boss[];
  /** Count of bosses defeated at this tier's difficulty in this sub-raid.
   *  Always equal to killedSlugs.length when killedSlugs is populated;
   *  retained as a separate field for back-compat with snapshots predating
   *  per-boss kill probing. */
  killed: number;
  /** Slugs of bosses actually defeated at this tier's difficulty in this
   *  sub-raid (subset of bosses[].slug). Populated when the snapshot was
   *  built with per-boss kill probing. Absent on older snapshots — callers
   *  should fall back to the prefix-slice convention (first `killed` bosses
   *  are defeated) when missing. */
  killedSlugs?: string[];
};

export type TierState = {
  raidName: string;
  totalBosses: number;
  difficulty: Difficulty;
  killed: number;
  bosses: Boss[];
  /** Slugs of bosses actually defeated at this difficulty across the whole
   *  tier. Source of truth for per-boss kill state — see SubRaid.killedSlugs
   *  for the same shape scoped to a sub-raid. Absent on older snapshots. */
  killedSlugs?: string[];
  /** Optional sub-raid groupings when a tier ships multiple raids together. */
  subRaids?: SubRaid[];
};

export type GuildRanking = {
  difficulty: Difficulty;
  world: number;
  region: number;
  realm: number;
};

export type Affix = {
  id: number;
  name: string;
  description: string;
  iconUrl: string;
  wowheadUrl: string;
};

export type MythicPlusRun = {
  dungeon: string;
  shortName: string;
  level: number;
  completedAt: string;
  clearTimeMs: number;
  parTimeMs: number;
  upgrades: number; // 0 = depleted/in-time, 1 = +2 (one chest), 2 = +3, 3 = +4
  score: number;
  iconUrl: string;
  url: string;
};

/** Per-character "Resilient X" tier — earned by clearing every active-season
 *  dungeon at +X or higher (timed). `level` is min over their best-per-dungeon
 *  set; `earnedAt` is the timestamp the tier was earned, kept stable across
 *  redos by diffing against the previous snapshot (level-ups get a fresh
 *  timestamp; unchanged levels preserve the prior `earnedAt`). `score` is
 *  the character's current RIO M+ season score, used to tiebreak the
 *  top-3 leaderboard when multiple guildies share the same Resilient level. */
export type ResilientAchievement = {
  runner: GuildRunner;
  level: number;
  earnedAt: string;
  score: number;
};

export type SelectedTalent = {
  nodeId: number;
  spellId: number;
  name: string;
  iconUrl: string;
  rank: number;
  maxRanks: number;
  row: number;
  col: number;
};

export type TalentSpec = {
  specId: number;
  specName: string;
  /** kebab-case version, e.g. "restoration" */
  specSlug: string;
  isActive: boolean;
  heroTalentName?: string;
  heroTalentSlug?: string;
  /** BNet media icon URL, if resolved */
  iconUrl?: string;
  heroIconUrl?: string;
  /** Only set on active spec (export string for in-game import) */
  loadoutCode?: string;
  /** Selected talents for the active loadout (active spec only) */
  classTalents?: SelectedTalent[];
  specTalents?: SelectedTalent[];
  heroTalents?: SelectedTalent[];
};

export type TalentLoadout = {
  classSlug: string;
  className: string;
  activeSpecId: number;
  specs: TalentSpec[];
};

export type GearItem = {
  slot: string;
  itemId: number;
  name: string;
  itemLevel: number;
  iconUrl: string;
  /** Blizzard quality: 0=poor, 1=common, 2=uncommon, 3=rare, 4=epic, 5=legendary */
  quality: number;
  /** Item bonus IDs — encode upgrade level, sockets, etc. */
  bonuses: number[];
  /** Gem item IDs */
  gems: number[];
  /** Enchant IDs (typically just one) */
  enchants: number[];
};

export type CharacterStats = {
  health: number;
  power?: number;
  powerType?: string;
  primaryStatLabel: "Strength" | "Agility" | "Intellect";
  primaryStatValue: number;
  stamina: number;
  /** Percentages */
  crit: number;
  critRating: number;
  haste: number;
  hasteRating: number;
  mastery: number;
  masteryRating: number;
  versatility: number;
  versatilityRating: number;
  /** Tertiaries (percentages) */
  avoidance: number;
  avoidanceRating: number;
  leech: number;
  leechRating: number;
  speed: number;
  speedRating: number;
};

export type AchievementSummary = {
  totalQuantity: number;
  totalPoints: number;
  recent: { id: number; name: string; timestamp: number }[];
  topCategories: { id: number; name: string; quantity: number; points: number }[];
};

/**
 * Per-character flags for the current raid tier's prestige achievements.
 * Each flag carries the timestamp it was earned (ms) for sorting/display.
 */
export type RaidTierBadges = {
  aotc?: number;
  ce?: number;
  hof?: number;
};

export type CollectionsSummary = {
  mountCount: number;
  petCount: number;
};

export type PvpBracket = {
  bracket: string;
  rating: number;
  seasonMatchStatistics?: { played?: number; won?: number; lost?: number };
};

export type PvpSummary = {
  honorLevel: number;
  honorableKills: number;
  brackets: PvpBracket[];
};

export type RaidDifficulty = "LFR" | "NORMAL" | "HEROIC" | "MYTHIC";

export type RaidEncounterRow = {
  encounterId: number;
  encounterName: string;
  iconUrl?: string;
  perDifficulty: Partial<
    Record<RaidDifficulty, { count: number; lastKillTimestamp: number }>
  >;
  /** Guild's first-kill roster per difficulty (where available). */
  killRosters?: Partial<Record<Difficulty, KillParticipant[]>>;
};

export type RaidInstance = {
  instanceId: number;
  instanceName: string;
  /** Landscape tile image URL from BNet's journal-instance media. May be missing. */
  tileUrl?: string;
  encounters: RaidEncounterRow[];
};

export type RaidEncountersData = {
  expansionName: string;
  instances: RaidInstance[];
};

/**
 * Fast subset of CharacterDetail — only data sourced from the single
 * Raider.IO profile fetch. Used by the character page layout to render the
 * hero (avatar, name, ilvl, M+ score, ranks) immediately while the BNet
 * fanout for talents/stats/raid encounters streams in via Suspense.
 */
/** A character's M+ score for a single season (current OR historical). */
export type SeasonScore = {
  /** RIO season slug, e.g. "season-mn-1", "season-tww-3", "season-df-4". */
  slug: string;
  /** Friendly display label, e.g. "Midnight Season 1". */
  label: string;
  /** Total M+ score for the season's "all" segment. */
  score: number;
  /** RIO color string for the score (orange/purple/blue/etc.), if non-default. */
  color?: string;
};

export type CharacterCore = {
  name: string;
  realm: string;
  realmSlug: string;
  faction: Faction;
  race: string;
  className: string;
  classKey: WowClass;
  spec: string;
  role: Role;
  ilvl?: number;
  /** Highest equipped item level ever observed for this character across
   *  snapshot rebuilds — same semantics as Character.peakIlvl. Stamped on
   *  CharacterCore so the character page hero + compare view can resist
   *  drops from PvP gear / leveling alts / off-spec sets. Sourced by
   *  cross-referencing the bundled snapshot roster at fetch time. */
  peakIlvl?: number;
  /** Unix ms when peakIlvl was first reached. Mirrors Character.peakIlvlAt. */
  peakIlvlAt?: number;
  mythicPlusScore?: number;
  mythicPlusScoreColor?: string;
  /** Per-role M+ scores from RIO — used to compute the character's
   *  "preferred" spec (highest-scoring role) for display, separate
   *  from whatever spec was active when RIO last refreshed. */
  roleScores: { tank: number; healer: number; dps: number };
  /** Current + historical seasons the character has scored in, recent first. */
  seasonScores: SeasonScore[];
  achievementPoints?: number;
  avatarUrl?: string;
  profileUrl?: string;
  realmClassRank?: number;
  regionClassRank?: number;
  worldClassRank?: number;
  recentRuns: MythicPlusRun[];
  bestRuns: MythicPlusRun[];
  gear: GearItem[];
  /** Current-tier RIO slug from this character's raid_progression. Used by
   *  getCharacterDetail to attach boss kill rosters without needing a
   *  separate guild snapshot fetch. */
  currentTierSlug?: string;
  raidProgression: {
    raidName?: string;
    totalBosses: number;
    normalKilled: number;
    heroicKilled: number;
    mythicKilled: number;
  } | null;
};

export type CharacterDetail = CharacterCore & {
  stats: CharacterStats | null;
  achievements: AchievementSummary | null;
  tierBadges: RaidTierBadges | null;
  collections: CollectionsSummary | null;
  pvp: PvpSummary | null;
  talents: TalentLoadout | null;
  raidEncounters: RaidEncountersData | null;
};

export type WeeklyAffixes = {
  title: string;
  affixes: Affix[];
};

export type KillParticipant = {
  name: string;
  realm: string;
  realmSlug: string;
  class: WowClass;
  spec: string;
  role: Role;
};

export type BossKill = {
  bossSlug: string;
  difficulty: Difficulty;
  defeatedAt: string;
  durationMs: number;
  avgIlvl: number;
  roster: KillParticipant[];
};

export type GuildSnapshot = {
  source: "raiderio" | "mock";
  fetchedAt: string;
  roster: Character[];
  tiers: TierState[];
  rankings: GuildRanking[];
  affixes?: WeeklyAffixes;
  /** Current-tier RIO slug — used by getCurrentTierKills() to fetch kill detail. */
  tierSlug?: string;
  /** Tier achievement icon (zamimg URL) for the current raid, if RIO knows it. */
  tierIconUrl?: string;
  /** Tier expansion name for the current raid header (e.g. "The War Within"). */
  tierExpansionName?: string;
  /** Top N recent M+ runs across the active roster, newest first */
  recentRuns: GuildRun[];
  /** Highest-scoring M+ runs since the last weekly reset, score-desc */
  weeklyTopRuns: GuildRun[];
  /** Per-character best keys since the weekly reset — each entry caps at
   *  RUNS_PER_CHARACTER runs, and the array caps at MAX_WEEKLY_CHARACTERS
   *  entries. Optional so older bundled snapshots without this field still
   *  parse; getGuildSnapshot() derives it on the fly when missing. */
  weeklyTopByCharacter?: CharacterWeeklyKeys[];
  /** Snapshot of `weeklyTopByCharacter` from the prior reset cycle. The cron
   *  populates this exactly once per reset boundary (when the previously
   *  bundled snapshot was fetched before the current reset, its weekly bucket
   *  IS last week's data), then carries the value forward for the rest of the
   *  week. The UI uses it as a fallback on the freshly-reset Tuesday morning
   *  when the live bucket is empty — otherwise "This Week's Pushers" would
   *  vanish from the page for the first several hours of every reset cycle. */
  previousWeekTopByCharacter?: CharacterWeeklyKeys[];
  /** Current-season "Resilient X" achievements per character. Only includes
   *  characters who have timed every active-season dungeon at +12 or higher;
   *  the celebration popup shows the subset with earnedAt within the last 7
   *  days. Optional so older bundled snapshots without this field still parse. */
  resilient?: ResilientAchievement[];
  /** Cached raider.io internal character IDs (name → id). Used by the
   *  Resilient detection pipeline to fetch role-partitioned run history
   *  from raider.io's internal endpoint without re-resolving the ID every
   *  snapshot rebuild. Optional; missing entries get re-fetched. */
  rioCharacterIds?: Record<string, number>;
};

export type GuildAchievement = {
  id: number;
  name: string;
  timestamp: number;
  character: GuildRunner;
};

/** A single character's recent notable achievements, grouped so the feed
 *  surfaces multiple raiders instead of one heavy farmer monopolizing the
 *  flat-timeline view. */
export type CharacterAchievements = {
  character: GuildRunner;
  achievements: Omit<GuildAchievement, "character">[];
  /** Timestamp (ms) of the character's most recent achievement — used to
   *  sort cards top-down. */
  latestAt: number;
};

export type RaidClear = {
  raidName: string;
  /** Empty when RIO has no static-data entry (pre-Legion raids). */
  raidSlug: string;
  difficulty: "Normal" | "Heroic" | "Mythic";
  completedAt: number;
  expansionId: number;
  expansionName: string;
  iconUrl?: string;
  /** Count of bosses the guild has killed at Mythic (probed via boss-kill). */
  mythicKilled?: number;
  /** Count of bosses cleared on Heroic (full N when Heroic/Mythic Guild Run achievement exists). */
  heroicKilled?: number;
  /** Total bosses in this raid. */
  totalBosses?: number;
};

export type PastRaidDetail = {
  slug: string;
  name: string;
  expansionName: string;
  iconUrl?: string;
  encounters: Boss[];
  /** key: `${bossSlug}-${difficulty}` → kill */
  kills: Record<string, BossKill>;
  totals: { Mythic: number; Heroic: number; Normal: number };
};

export const CLASS_LABEL: Record<WowClass, string> = {
  deathknight: "Death Knight",
  demonhunter: "Demon Hunter",
  druid: "Druid",
  evoker: "Evoker",
  hunter: "Hunter",
  mage: "Mage",
  monk: "Monk",
  paladin: "Paladin",
  priest: "Priest",
  rogue: "Rogue",
  shaman: "Shaman",
  warlock: "Warlock",
  warrior: "Warrior",
};

export const CLASS_COLOR_VAR: Record<WowClass, string> = {
  deathknight: "var(--color-class-deathknight)",
  demonhunter: "var(--color-class-demonhunter)",
  druid: "var(--color-class-druid)",
  evoker: "var(--color-class-evoker)",
  hunter: "var(--color-class-hunter)",
  mage: "var(--color-class-mage)",
  monk: "var(--color-class-monk)",
  paladin: "var(--color-class-paladin)",
  priest: "var(--color-class-priest)",
  rogue: "var(--color-class-rogue)",
  shaman: "var(--color-class-shaman)",
  warlock: "var(--color-class-warlock)",
  warrior: "var(--color-class-warrior)",
};
