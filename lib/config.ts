export const GUILD = {
  name: "Lessons in Brutality",
  shortName: "LIB",
  realm: "skullcrusher",
  realmDisplay: "Skullcrusher",
  region: "us",
  regionDisplay: "US",
  primaryFaction: "alliance" as const,
  blurb:
    "A Mythic/Heroic-progression raiding guild on Skullcrusher. Sharp pulls, sharper banter, and a roster that shows up.",
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
 * Account-level alt groupings for the entire guild. Each inner array is
 * one player's set of characters across all classes/specs. Used by
 * TopPerformers to dedupe — a player with two healer alts in the top 5
 * occupies one slot (with both characters stacked underneath), so the
 * "Top 5" list represents 5 unique players rather than 5 characters.
 *
 * Battle.net's API doesn't expose account-level alt linking, so this
 * has to be maintained by hand. Add a row when you discover an alt
 * pairing — order within the inner array doesn't matter, the higher
 * scoring character is automatically picked as the slot's primary.
 */
export const ALT_GROUPS: readonly (readonly string[])[] = [
  ["Trinitree", "Totemtartt"],
];

export const ROSTER_PINS: { name: string; role?: "tank" | "healer" | "dps" }[] = [
  // Leaders — already covered by GUILD_LEADER_GROUPS but listing here
  // makes the always-include intent explicit.
  { name: "Giaus" },
  { name: "Anorxxorcist" },
  { name: "Kujatas" },
  // Healers that have dropped from bulk responses
  { name: "Trinitree", role: "healer" },
  // Tanks whose RIO snapshot active spec misclassifies them
  { name: "Gabriel", role: "tank" },
  { name: "Pandidin", role: "tank" },
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
 * Update this when the next tier ships. If empty, badges are hidden.
 */
export const CURRENT_TIER_FINAL_BOSS = "Sols, the Burning Sun";

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
  raidStatic: 60 * 60 * 24, // 24h — boss list / raid metadata
  affixes: 60 * 60 * 6, // 6h — affixes change weekly so this is generous
  bossKill: 60 * 60 * 6, // 6h — kill timestamps are immutable once set
};
