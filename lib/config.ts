export const GUILD = {
  name: "Lessons in Brutality",
  shortName: "LIB",
  realm: "skullcrusher",
  realmDisplay: "Skullcrusher",
  region: "us",
  regionDisplay: "US",
  primaryFaction: "alliance" as const,
  blurb:
    "Mythic/Heroic-progression raiding on Skullcrusher. We come back. The bosses don't.",
};

/**
 * Which Raider.IO member ranks to consider for the public roster. The
 * activity filter (ROSTER_FILTER) does the real work of identifying mains —
 * this just controls which ranks to evaluate at all.
 *
 * Default is "all ranks" because guilds set rank meanings differently:
 * sometimes raiders sit at rank 3, sometimes rank 5, sometimes inverted.
 * The activity filter (current-tier Heroic+ kills) catches actual mains
 * regardless of where the guild has them ranked.
 */
export const RAIDER_RANKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Max concurrent character profile fetches against Raider.IO.
 *  Vercel serverless functions share egress IPs, so a high fan-out from
 *  one lambda hits RIO's per-IP rate limit harder than a local dev fetch
 *  from a residential IP. Keep this conservative — a slower snapshot build
 *  is fine; partial roster data is not. */
export const ENRICHMENT_CONCURRENCY = 6;

/** Concurrency for the character-sheet detail generator (precompute step).
 *  Lower than ENRICHMENT_CONCURRENCY because each character does a FRESH RIO
 *  profile fetch with no 429-retry on that path — a backfill burst of the whole
 *  roster at 6-wide trips RIO's per-IP rate limit and most fetches come back
 *  empty. At 3-wide a full backfill still completes well under the route's
 *  maxDuration, and the steady-state incremental run (a few characters) is
 *  unaffected. RIO blocks the IP after a short burst, so keep this low — a
 *  serial-ish trickle stays under the limit and a clean backfill completes
 *  without the rate-limit failures a wider fan-out hits. */
export const DETAIL_GEN_CONCURRENCY = 2;

/** Max age the enrichRoster cache will be REUSED for an active-this-week
 *  character before forcing a fresh fetch — even if RIO's `last_crawled_at`
 *  is unchanged. RIO updates a character's run lists (new keys) WITHOUT
 *  reliably bumping last_crawled_at, so reuse keyed on that stamp froze active
 *  players' weekly keys / scores for a long time (a member's +19s sat on RIO
 *  for ~40h while we kept serving their pre-+19 cache). Capping reuse for the
 *  active subset bounds that lag to this window. Inactive players (stable data)
 *  keep reusing the cache indefinitely, so the extra fetch/parse cost is
 *  limited to the handful actively running keys. */
export const ENRICH_ACTIVE_MAX_STALENESS_MS = 2 * 60 * 60 * 1000;

/**
 * Custom labels for in-game guild ranks. Battle.net's API does NOT expose
 * the rank names players see in-game (those live only on the WoW client).
 * Fill in your guild's actual rank names below to replace the generic
 * "GM"/"Member" defaults on roster cards.
 *
 * Rank 0 is always the Guild Master in WoW. Lower numbers = higher rank.
 * Looking at LIB's rank distribution: 1 GM, 2 at rank 1, 11 at rank 2,
 * 96 at rank 3, then 5+ for alts/socials.
 *
 * Example for a guild with these ranks:
 *   {
 *     0: "Guild Master",
 *     1: "Officer",
 *     2: "Class Lead",
 *     3: "Raider",
 *     5: "Member",
 *     6: "Alt",
 *     7: "Trial",
 *     8: "Social",
 *     9: "Inactive",
 *   }
 */
export const RANK_LABELS: Record<number, string> = {
  0: "Guild Master",
};

/**
 * Guild leadership grouped by player. Each inner array is one player's set
 * of characters (main + alts). Battle.net doesn't expose account-level alt
 * links via public API, so we have to enumerate.
 *
 * All names get the "Guild Leader" badge regardless of in-game rank. The
 * roster sort uses the highest-M+-score character per group as the "top"
 * representative, pinned at the top of the roster — lower-scoring alts of
 * the same player fall back into the regular rank-based sort below.
 */
export const GUILD_LEADER_GROUPS = [
  // Giaus + alts
  ["Giaus"],
  // The two Anor characters belong to the same player — only the higher-M+
  // one gets pinned at top. (Anorexorcist is the rank-0 parked GM toon;
  // Anorxxorcist is the active main per project memory.)
  ["Anorxxorcist", "Anorexorcist"],
  // Kujatas + alts
  ["Kujatas"],
] as const;
export const GUILD_LEADER_CHARACTERS = GUILD_LEADER_GROUPS.flat();

/**
 * Highest in-guild rankNumber that still counts as an officer. Anyone with
 * rankNumber <= this (and not already a guild leader) gets the "Officer"
 * badge on the roster grid and shows up in the Officers section on About.
 *
 * In WoW lower rankNumber = higher rank. LIB's rank 2 is the officer tier
 * (Prohealin and peers); ranks 0 and 1 are leaders, who keep the Guild
 * Leader treatment instead of the officer one.
 */
export const OFFICER_RANK_THRESHOLD = 2;

/**
 * Manually-pinned characters. RIO's bulk guild-members endpoint is
 * unreliable — sometimes it returns 200 OK with a partial list, randomly
 * dropping members. Names listed here get fetched directly by name when
 * missing from the bulk response, so the roster never silently drops
 * them.
 *
 * Optional `role` override: forces a character into a specific role
 * column on TopPerformers + the roster, regardless of what their M+
 * score split says. Use this when RIO's data doesn't match what they
 * actually play (e.g. a Prot Paladin who PUGs Ret keys higher than
 * their tank keys would otherwise bucket as DPS).
 *
 * Add new entries here when you spot a recurring drop or misclassed
 * character. No code change needed beyond editing this list — the
 * snapshot pipeline picks it up automatically.
 */
/**
 * MANUAL FALLBACK for account-level alt groupings. Most groupings are now
 * derived automatically from each character's `claimedOwner` field, which
 * snapshot enrichment pulls from RIO's internal `/api/characters/.../{c}`
 * endpoint (the `user.name` is exposed there when the player has claimed
 * the character on raider.io). Auto-detect wins when `claimedOwner` is
 * present — only fall back to this list for players who haven't claimed.
 *
 * Add a row only when you spot a multi-character player on TopPerformers
 * who isn't being grouped automatically. Once they claim on RIO, you can
 * delete the row — the auto-detect will take over on the next snapshot.
 * Order within an inner array doesn't matter; the higher-scoring character
 * gets picked as the slot's primary.
 */
export const ALT_GROUPS: readonly (readonly string[])[] = [
  // Treetartt's healer group (Trinitree / Totemtartt / Serenitree / Treespriest)
  // is auto-detected via claimedOwner — no manual entry needed.
  // Anor's tanks (Anorxxorcist + Anorexorcist) likewise auto-detect now that
  // his RIO profile is public (user.name = "Anorexorcist" on both).
];

export const ROSTER_PINS: {
  name: string;
  /** Realm slug (e.g. "skullcrusher", "bloodhoof", "nerzhul"). Defaults
   *  to the guild's home realm. Required for cross-realm characters —
   *  the guild spans many realms even though it's hosted on Skullcrusher,
   *  and a pin lookup on the wrong realm silently 404s. */
  realm?: string;
  role?: "tank" | "healer" | "dps";
  /** Display-spec override. RIO returns `active_spec_name` (whatever the
   *  character was last logged into), which can mislead — e.g. a Resto
   *  Druid logged out as Balance shows up as "Balance" everywhere on the
   *  site. Set this to force the displayed spec on the roster, character
   *  page, and compare view. Doesn't affect M+ score bucketing. */
  spec?: string;
}[] = [
  // Leaders — already covered by GUILD_LEADER_GROUPS but listing here
  // makes the always-include intent explicit.
  { name: "Giaus" },
  { name: "Anorxxorcist" },
  { name: "Kujatas" },
  // Healers that have dropped from bulk responses
  { name: "Trinitree", role: "healer" },
  // Tanks whose RIO snapshot active spec misclassifies them
  { name: "Gabriel", realm: "scilla", role: "tank" },
  { name: "Pandidin", role: "tank" },
  // Chronic bulk-fetch drops: RIO's /guilds/profile?fields=members
  // silently omits these names every call. Without pinning, they get
  // backfilled from the prior snapshot's cached roster entry but their
  // runs never attach to the live run feed — so they appear active in
  // the sidebar yet vanish from "Latest Mythic+ Runs" attribution.
  { name: "Grimstab" },
  { name: "Robyv" },
  { name: "Sugardaddie", realm: "bloodhoof" },
  { name: "Hoverboots", realm: "nerzhul" },
  // Spec-display overrides: characters whose RIO active_spec is misleading
  // (logged out as an offspec) and would otherwise display the wrong spec
  // across roster / compare / character pages.
  { name: "Phury", realm: "velen", role: "healer", spec: "Restoration" },
];
export const GUILD_LEADER_LABEL = "Guild Leader";

/**
 * Activity filter mode for the public roster. Determines which characters
 * are shown vs. hidden as parked alts / non-mains.
 *
 * - "auto"    (default): match the guild's current-tier hardest-difficulty
 *   kills. If the guild has Heroic kills, only show characters with a Heroic
 *   kill. Auto-ramps as the guild progresses into Mythic. Best for showing
 *   the actual raid team.
 * - "mythic" | "heroic" | "normal": hard-coded minimum difficulty.
 * - "any":  show characters with any current activity (M+ score > 0 OR any
 *   raid kill). Loose — includes M+ pushers who raid on a different toon.
 * - "none": no activity filtering, show all ranked characters.
 */
export const ROSTER_FILTER = {
  mode: "auto" as "auto" | "mythic" | "heroic" | "normal" | "any" | "none",
  /** Always show these ranks regardless of activity filter. [0] keeps the GM visible. */
  alwaysShowRanks: [0] as number[],
  /**
   * Recency gate (days). A character must have run a Mythic+ key within
   * this window to appear on the roster. Drops abandoned alts and old
   * mains after a player switches characters. Set to a large number to
   * effectively disable, or 0 to disable entirely.
   */
  recencyDays: 30,
  /**
   * M+ score threshold that grants a character a roster spot regardless
   * of raid prog. Catches active M+ pushers and players who main-switched
   * during a tier (their new toon won't have current raid kills yet, but
   * will have built up an M+ score quickly). Set to 99999 to disable.
   */
  mplusPusherScore: 1500,
};

/**
 * Departure grace window (hours). RIO's guild-members endpoint sometimes 200s
 * with random characters dropped, so the roster build backfills members who are
 * missing from a single live response using last-known-good data. The risk is
 * that a member who genuinely LEFT the guild looks identical to one RIO flakily
 * dropped — both are "absent from live, present in the saved snapshot". This
 * window resolves the ambiguity: a member is backfilled only while they've been
 * seen live within this many hours; stay absent longer and they're treated as
 * departed and quietly drop off the roster. Long enough to ride out RIO
 * flakiness and short multi-hour API outages, short enough that a real
 * departure clears within a day. (Members on a raid break are NOT affected —
 * they stay in RIO's guild roster, so they keep getting seen live.)
 */
export const DEPARTURE_GRACE_HOURS = 24;

/**
 * Raider.IO raid slugs map to placeholder names in their static-data API
 * for new tiers (e.g. "MN Tier 1 (VS / DR / MQD)"). Override the display
 * name here once the official raid name is known.
 */
export const RAID_NAME_OVERRIDES: Record<string, string> = {
  // "tier-mn-1": "Manaforge Omega",
};

/**
 * Some tiers ship as multiple raids that progress together (e.g. Midnight
 * Tier 1 = Voidspire + Dreamrift + March on Quel'Danas). When that's the
 * case, list the sub-raids here keyed by Raider.IO tier slug. The progression
 * page uses this to group bosses under per-raid banners.
 *
 * `bnetName` is the Battle.net journal-instance name — used to pull the
 * raid tile (banner) image and per-boss creature portraits. Get the name
 * from `/api/debug/instances` or the BNet journal-instance index.
 *
 * `bossSlugs` are Raider.IO encounter slugs in display order. They must
 * match RIO's slugs from the static-data response for the parent tier.
 */
export type SubRaidConfig = {
  name: string;
  bnetName: string;
  bossSlugs: string[];
};

export const TIER_SUB_RAIDS: Record<string, SubRaidConfig[]> = {
  "tier-mn-1": [
    {
      name: "The Voidspire",
      bnetName: "The Voidspire",
      bossSlugs: [
        "imperator-averzian",
        "vorasius",
        "fallenking-salhadaar",
        "vaelgor-ezzorak",
        "lightblinded-vanguard",
        "crown-of-the-cosmos",
      ],
    },
    {
      name: "The Dreamrift",
      bnetName: "The Dreamrift",
      bossSlugs: ["chimaerus-the-undreamt-god"],
    },
    {
      name: "March on Quel'Danas",
      bnetName: "March on Quel'Danas",
      bossSlugs: ["beloren-child-of-alar", "midnight-falls"],
    },
  ],
};

/**
 * Final-boss name for the current tier. Used to detect AOTC / Cutting Edge /
 * Hall of Fame achievements per character — those achievements take the form
 * "Ahead of the Curve: {final boss}", "Cutting Edge: {final boss}", etc.
 *
 * Leave this as "" for the auto-detect path: badge detection falls back to
 * matching any "Ahead of the Curve:" / "Cutting Edge:" / "Hall of Fame:"
 * achievement earned within the current-tier window
 * (TIER_BADGE_RECENCY_DAYS). That makes new tiers work with zero config —
 * the trade-off is that for ~the first month after a new tier ships, a
 * character who has previous-tier AOTC but not yet this-tier AOTC can be
 * mis-tagged. Set this to the exact final-boss name to disable the
 * heuristic and use strict substring matching instead.
 */
export const CURRENT_TIER_FINAL_BOSS = "";

/**
 * How recently (in days) an AOTC/CE/HoF achievement must have been earned
 * to count as the current tier when CURRENT_TIER_FINAL_BOSS is unset.
 * Tiers typically run 4-6 months, so 270 days catches the current tier
 * reliably without bleeding into the one before it.
 */
export const TIER_BADGE_RECENCY_DAYS = 270;

/**
 * How many of the highest-M+-scoring roster characters to scan for the
 * Mythic+ seasonal "Hero" title (top 0.1%) during the snapshot build. The
 * title requires a top-0.1% region score, so only the guild's very top
 * pushers can possibly hold it — scanning the top N (rather than the whole
 * roster) keeps the snapshot build's BNet load bounded and well under the
 * Vercel function timeout. 12 is generous headroom over any realistic count
 * of guild title-holders. (The per-character roster/character-page badge is
 * unaffected — it rides the existing full-roster enrichment fetch.)
 */
export const SEASON_TITLE_SCAN_LIMIT = 12;

/**
 * Manual overrides for the Mythic+ seasonal title, keyed by character name
 * (exact, case-sensitive — matches the roster `name`). Mirrors the spirit of
 * RESILIENT_OVERRIDES.
 *
 * Two uses:
 *   - `grant`: hand-award the title to a character. The point of this is the
 *     guild's FIRST holder: Blizzard's Feat of Strength achievement may not be
 *     queryable until late in / after the season, but if you KNOW someone hit
 *     the top 0.1% you can acknowledge them now. A granted entry shows
 *     everywhere a detected one does, flagged `manual`. Auto-detection takes
 *     precedence when it later finds the real achievement.
 *   - `hide`: suppress a detected title (e.g. a stale prior-season title on a
 *     returning alt you don't want surfaced as "current").
 *
 * Leave empty in normal operation — detection is automatic and rolls season to
 * season on its own.
 */
export type SeasonTitleGrant = {
  title: string;
  name: string;
  season: string;
  earnedAt: number;
  /** Accolade tier — "hero" (top 0.1% title, gold) or "champion" (top 1%
   *  achievement, silver). Omit for the Hero default. */
  tier?: "hero" | "champion";
};

export type SeasonTitleOverride =
  | { grant: SeasonTitleGrant | SeasonTitleGrant[]; hide?: false }
  | { hide: true };

export const SEASON_TITLE_OVERRIDES: Record<string, SeasonTitleOverride> = {};

/**
 * Expansion abbreviation (as it appears in RIO slugs like "tier-mn-1" or
 * "season-tww-3") → friendly display label. Unknown abbreviations fall
 * back to their uppercase form (e.g. an unmapped "abc" renders as "ABC
 * Season 1"), so the site stays functional through a new-expansion launch
 * even if this map hasn't been updated yet.
 */
export const EXPANSION_LABEL: Record<string, string> = {
  mn: "Midnight",
  tww: "TWW",
  df: "Dragonflight",
  sl: "Shadowlands",
  bfa: "BfA",
  bfb: "BfA",
  legion: "Legion",
};

/**
 * Build the current season's title descriptor (e.g. "Midnight Season One") from
 * the snapshot's expansion name + tier/season slug, to match against the
 * `season` string on a detected title ("<X> Hero: Midnight Season One"). Used
 * to keep the HOME marquee strictly to the *current* season's holders, while
 * the roster keeps every title a character has collected. Returns null if it
 * can't derive a confident label (callers then fall back to showing all, so a
 * real holder is never hidden by a parsing miss).
 */
/** Spelled-out ordinals BNet uses in season title strings ("...Season Three").
 *  Covers well past any realistic season count; unknown words fall through. */
const ORDINAL_TO_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
};

/** Pull the season number out of a detected title's season descriptor, e.g.
 *  "Midnight Season One" → 1, "Foo Season 3" → 3. Returns null if unparseable. */
function parseSeasonNumber(season: string): number | null {
  const s = season.toLowerCase().trim();
  const m = s.match(/season\s+([a-z]+|\d+)\s*$/);
  const token = m ? m[1] : s.match(/(\d+)\s*$/)?.[1];
  if (!token) return null;
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  return ORDINAL_TO_NUM[token] ?? null;
}

/**
 * Whether a detected season-title's `season` descriptor belongs to the CURRENT
 * season — used to keep the HOME marquee to current holders while the roster
 * keeps every title. Matches by season NUMBER (derived from the tier/season
 * slug) plus a LENIENT expansion check, rather than exact string equality, so:
 *   - it works past "Season Ten" (no spelled-ordinal ceiling), and
 *   - a slight expansion-name mismatch never hides every holder (the old
 *     exact-equality failure mode) — only a wrong season number filters one out.
 * Fails OPEN (returns true) whenever it can't derive a confident number, so a
 * real holder is never hidden by a parsing miss.
 */
export function isCurrentSeasonTitle(
  titleSeason: string,
  expansionName: string | undefined,
  slug: string | undefined,
): boolean {
  const sm = slug?.match(/-(\d+)$/);
  const curNum = sm ? parseInt(sm[1], 10) : NaN;
  if (!Number.isFinite(curNum)) return true; // can't derive → don't hide anyone
  const titleNum = parseSeasonNumber(titleSeason);
  if (titleNum == null) return true; // unparseable → lenient
  if (titleNum !== curNum) return false;
  // Guard a cross-expansion "Season One" collision, but only when we have a
  // confident expansion name to check against.
  if (expansionName) {
    return titleSeason.toLowerCase().includes(expansionName.toLowerCase());
  }
  return true;
}

/** Extract the expansion abbreviation from a RIO tier/season slug. */
export function expansionAbbrevFromSlug(slug: string | undefined): string | null {
  if (!slug) return null;
  const parts = slug.replace(/^(?:tier|season)-/, "").split("-");
  return parts[0] ?? null;
}

/**
 * Resolve a RIO tier/season slug to its expansion display label. Falls back
 * to the uppercase abbreviation if EXPANSION_LABEL doesn't know the
 * expansion yet, so a brand-new expansion still renders sensibly without
 * touching this file.
 */
export function expansionLabelFromSlug(slug: string | undefined): string | null {
  const abbrev = expansionAbbrevFromSlug(slug);
  if (!abbrev) return null;
  return EXPANSION_LABEL[abbrev] ?? abbrev.toUpperCase();
}

/**
 * Target raid composition used to derive recruitment needs from the active
 * roster. The recruit page surfaces a "Currently Recruiting" card showing
 * where the live roster is short of these targets.
 *
 * Defaults model a standard 20-player Mythic comp. Adjust per the guild's
 * actual aspirations (e.g. heroic-only guilds may want a smaller bench).
 */
export const IDEAL_MYTHIC_COMP = {
  tank: 2,
  healer: 4,
  dps: 14,
} as const;

/** ISR revalidate windows (seconds) */
export const REVALIDATE = {
  guild: 60 * 60, // 1h — roster + progression
  raidStatic: 60 * 60 * 24, // 24h — boss list / raid metadata (new-tier miss is retried no-store in fetchRaidMeta)
  affixes: 60 * 60 * 6, // 6h — affixes change weekly so this is generous
  // 1h — aligns with the hourly snapshot so a fresh kill (or a stale pre-kill
  // RIO edge response) can't sit cached longer than one rebuild cycle. Kill
  // timestamps are immutable once set, so a short TTL only costs a few refetches.
  bossKill: 60 * 60,
};
