import type {
  AchievementSummary,
  CharacterStats,
  CollectionsSummary,
  GearItem,
  PvpSummary,
  RaidClear,
  RaidDifficulty,
  RaidEncountersData,
  RaidTierBadges,
  SelectedTalent,
  TalentLoadout,
  TalentSpec,
} from "./types";
import { TIER_BADGE_RECENCY_DAYS } from "./config";

/** Raid clear before expansion metadata is stamped on by the orchestration layer. */
export type RawRaidClear = Pick<
  RaidClear,
  "raidName" | "difficulty" | "completedAt"
>;

const REGION = process.env.BNET_REGION ?? "us";
const OAUTH_URL = "https://oauth.battle.net/token";
const API_BASE = `https://${REGION}.api.blizzard.com`;
const NAMESPACE = `profile-${REGION}`;
const LOCALE = "en_US";

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  const id = process.env.BNET_CLIENT_ID;
  const secret = process.env.BNET_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("[bnet] token fetch failed:", res.status);
    return null;
  }
  const data: { access_token: string; expires_in: number } = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

type BnetStat<T = number> = {
  rating_bonus?: number;
  value?: number;
  rating_normalized?: number;
} | T;

type BnetStatsResponse = {
  health?: number;
  power?: number;
  power_type?: { name?: string };
  strength?: { base?: number; effective?: number };
  agility?: { base?: number; effective?: number };
  intellect?: { base?: number; effective?: number };
  stamina?: { base?: number; effective?: number };
  melee_crit?: BnetStat;
  spell_crit?: BnetStat;
  ranged_crit?: BnetStat;
  melee_haste?: BnetStat;
  spell_haste?: BnetStat;
  ranged_haste?: BnetStat;
  mastery?: BnetStat;
  versatility?: number;
  versatility_damage_done_bonus?: number;
  versatility_healing_done_bonus?: number;
  versatility_damage_taken_bonus?: number;
  avoidance?: BnetStat;
  lifesteal?: BnetStat;
  speed?: BnetStat;
};

function pickPrimary(
  s: BnetStatsResponse,
): { label: "Strength" | "Agility" | "Intellect"; value: number } {
  const str = s.strength?.effective ?? 0;
  const agi = s.agility?.effective ?? 0;
  const int = s.intellect?.effective ?? 0;
  if (int >= str && int >= agi) return { label: "Intellect", value: int };
  if (agi >= str) return { label: "Agility", value: agi };
  return { label: "Strength", value: str };
}

function pctValue(stat: BnetStat | undefined): number {
  if (stat == null) return 0;
  if (typeof stat === "number") return stat;
  return stat.value ?? stat.rating_bonus ?? 0;
}

function pctRatingBonus(stat: BnetStat | undefined): number {
  if (stat == null) return 0;
  if (typeof stat === "number") return stat;
  return stat.rating_bonus ?? 0;
}

function ratingNormalized(stat: BnetStat | undefined): number {
  if (stat == null) return 0;
  if (typeof stat === "number") return stat;
  return stat.rating_normalized ?? 0;
}

// Global concurrency cap for BNet API calls. Talent resolution fans out
// 240+ spell-icon lookups per character page (3-4 specs × ~60-80 talents),
// and on Vercel's shared-IP serverless runtime that storm trips BNet's
// per-IP rate limit, leaving empty boxes scattered across the talent grid.
// Limiting in-flight calls to BNET_MAX_CONCURRENT keeps the request rate
// inside BNet's tolerance regardless of how many callers fan out.
const BNET_MAX_CONCURRENT = 6;
const bnetGlobalStore = globalThis as unknown as {
  __libBnetActive?: number;
  __libBnetQueue?: (() => void)[];
};
bnetGlobalStore.__libBnetActive ??= 0;
bnetGlobalStore.__libBnetQueue ??= [];

async function withBnetSlot<T>(fn: () => Promise<T>): Promise<T> {
  if ((bnetGlobalStore.__libBnetActive ?? 0) >= BNET_MAX_CONCURRENT) {
    await new Promise<void>((resolve) =>
      bnetGlobalStore.__libBnetQueue!.push(resolve),
    );
  }
  bnetGlobalStore.__libBnetActive!++;
  try {
    return await fn();
  } finally {
    bnetGlobalStore.__libBnetActive!--;
    const next = bnetGlobalStore.__libBnetQueue!.shift();
    if (next) next();
  }
}

async function bnetFetch(
  path: string,
  opts?: { skipNextCache?: boolean; namespace?: string },
): Promise<unknown> {
  return withBnetSlot(() => bnetFetchInner(path, opts));
}

async function bnetFetchInner(
  path: string,
  opts?: { skipNextCache?: boolean; namespace?: string },
): Promise<unknown> {
  const token = await getToken();
  if (!token) return null;
  const ns = opts?.namespace ?? NAMESPACE;
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}namespace=${ns}&locale=${LOCALE}`;
  // Retry transient BNet failures up to 4 times. Talent fan-out issues
  // 60+ spell-icon lookups in one render; without retries, even a 1%
  // hiccup rate leaves a few empty icons per character page. 404 is a
  // real miss — return null immediately. 429 honors Retry-After. 5xx,
  // parse errors, and network errors back off exponentially.
  for (let attempt = 0; attempt < 4; attempt++) {
    let parseFailed = false;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        ...(opts?.skipNextCache
          ? { cache: "no-store" as const }
          : { next: { revalidate: 3600 } }),
      });
      if (res.ok) {
        try {
          return await res.json();
        } catch (err) {
          // BNet occasionally returns HTML (rate-limit page, edge error)
          // with a 200 status. Treat parse failures as transient + retry.
          console.error("[bnet]", path, "json parse failed:", err);
          parseFailed = true;
        }
      } else if (res.status === 404) {
        return null;
      } else if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10);
        const wait = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 1000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      } else if (res.status < 500) {
        console.error("[bnet]", path, "failed:", res.status);
        return null;
      } else {
        console.error("[bnet]", path, "failed:", res.status);
      }
    } catch {
      // network error — fall through to retry
    }
    if (attempt < 3) {
      await new Promise((r) =>
        setTimeout(r, parseFailed ? 600 * (attempt + 1) : 400 * (attempt + 1)),
      );
    }
  }
  return null;
}

// Lightweight in-memory cache for shaped data — used for endpoints whose
// raw responses exceed Next.js's 2MB fetch-cache limit. We shape down to a
// few KB and cache that here instead. Pinned to globalThis so it persists
// across Next.js dev's per-route bundle isolation (each route has its own
// module instance otherwise; without sharing, every tab navigation would
// re-fetch the same character's data from BNet).
type BnetGlobalCache = {
  memCache: Map<string, { value: unknown; expiresAt: number }>;
  memInFlight: Map<string, Promise<unknown | null>>;
};
const bnetGlobal = globalThis as unknown as { __bnetCache?: BnetGlobalCache };
bnetGlobal.__bnetCache ??= {
  memCache: new Map(),
  memInFlight: new Map(),
};
const memCache = bnetGlobal.__bnetCache.memCache;
const memInFlight = bnetGlobal.__bnetCache.memInFlight;

async function memo<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T | null>,
): Promise<T | null> {
  const hit = memCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const inFlight = memInFlight.get(key);
  if (inFlight) return inFlight as Promise<T | null>;
  const promise = (async () => {
    try {
      const value = await fn();
      if (value !== null) {
        memCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      }
      return value;
    } finally {
      memInFlight.delete(key);
    }
  })();
  memInFlight.set(key, promise);
  return promise;
}

/** Fetches a character's avatar URL from BNet character-media. Used as a
 *  fallback when Raider.IO doesn't return a thumbnail (gaps happen
 *  occasionally in RIO's data, particularly for transferred characters
 *  or those with privacy-restricted profiles). */
export async function getCharacterAvatar(
  realmSlug: string,
  characterName: string,
): Promise<string | null> {
  const lc = characterName.toLowerCase();
  return memo(`avatar:${realmSlug}:${lc}`, 24 * 3600 * 1000, async () => {
    type Resp = { assets?: { key?: string; value?: string }[] };
    const data = (await bnetFetch(
      `/profile/wow/character/${realmSlug}/${lc}/character-media`,
    )) as Resp | null;
    if (!data) return null;
    return (
      data.assets?.find((a) => a.key === "avatar")?.value ??
      data.assets?.[0]?.value ??
      null
    );
  });
}

// Item icon URLs by item ID — equipment icons are stable (item icons
// don't change), so cache forever within the lambda. Same null-not-cached
// rule as spellIconCache to avoid sticky empty-icon bugs on transient
// BNet hiccups.
const itemIconCache = new Map<number, string | null>();

async function getItemIconUrl(itemId: number): Promise<string | null> {
  if (itemIconCache.has(itemId)) return itemIconCache.get(itemId) ?? null;
  type Resp = { assets?: { key?: string; value?: string }[] };
  const data = (await bnetFetch(`/data/wow/media/item/${itemId}`, {
    namespace: `static-${REGION}`,
  })) as Resp | null;
  const url =
    data?.assets?.find((a) => a.key === "icon")?.value ??
    data?.assets?.[0]?.value ??
    null;
  if (url) itemIconCache.set(itemId, url);
  return url;
}

const BNET_SLOT_TO_KEY: Record<string, string> = {
  HEAD: "head",
  NECK: "neck",
  SHOULDER: "shoulder",
  BACK: "back",
  CHEST: "chest",
  WRIST: "wrist",
  HANDS: "hands",
  WAIST: "waist",
  LEGS: "legs",
  FEET: "feet",
  FINGER_1: "finger1",
  FINGER_2: "finger2",
  TRINKET_1: "trinket1",
  TRINKET_2: "trinket2",
  MAIN_HAND: "mainhand",
  OFF_HAND: "offhand",
  // SHIRT and TABARD are intentionally not mapped — we don't show them.
};

const BNET_QUALITY_TO_INT: Record<string, number> = {
  POOR: 0,
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 3,
  EPIC: 4,
  LEGENDARY: 5,
  ARTIFACT: 6,
  HEIRLOOM: 7,
};

/**
 * Pulls the character's currently-equipped gear from BNet. This is the
 * source of truth — RIO's gear data only refreshes when the player logs
 * out or runs M+, so a player who swapped sets in-game without logging
 * out shows stale gear in RIO. BNet always reflects what the armory
 * shows. Returns shaped gear items + the equipped item level.
 */
export async function getCharacterEquipment(
  realmSlug: string,
  characterName: string,
): Promise<{ items: GearItem[]; ilvl: number } | null> {
  type RawItem = {
    item: { id: number };
    slot: { type: string };
    quality?: { type: string };
    name?: string;
    level?: { value?: number };
    bonus_list?: number[];
    sockets?: { item?: { id?: number } }[];
    enchantments?: {
      enchantment_id?: number;
      source_item?: { id?: number };
    }[];
  };
  type Resp = { equipped_items?: RawItem[] };
  const lc = characterName.toLowerCase();
  // Skip Next.js fetch cache: equipment is exactly the kind of data that
  // turns over fast (gear swaps, new drops, PvP set toggles). The default
  // 1h revalidate window kept stale gear visible long after BNet armory
  // updated — the snapshot pipeline kept inheriting the cached response.
  const data = (await bnetFetch(
    `/profile/wow/character/${realmSlug}/${lc}/equipment`,
    { skipNextCache: true },
  )) as Resp | null;
  if (!data?.equipped_items?.length) return null;

  // Filter to slots we display, drop shirt/tabard/etc.
  const equipped = data.equipped_items.filter(
    (i) => BNET_SLOT_TO_KEY[i.slot.type] != null,
  );

  const items = await Promise.all(
    equipped.map(async (i): Promise<GearItem> => {
      const slot = BNET_SLOT_TO_KEY[i.slot.type] ?? i.slot.type.toLowerCase();
      const iconUrl = (await getItemIconUrl(i.item.id)) ?? "";
      const gems = (i.sockets ?? [])
        .map((s) => s.item?.id)
        .filter((id): id is number => typeof id === "number");
      const enchants = (i.enchantments ?? [])
        .map((e) => e.source_item?.id ?? e.enchantment_id)
        .filter((id): id is number => typeof id === "number");
      return {
        slot,
        itemId: i.item.id,
        name: i.name ?? "Unknown",
        itemLevel: i.level?.value ?? 0,
        iconUrl,
        quality: BNET_QUALITY_TO_INT[i.quality?.type ?? ""] ?? 4,
        bonuses: i.bonus_list ?? [],
        gems,
        enchants,
      };
    }),
  );

  // Equipped item level the way WoW shows it in-game: sum the 16 equip
  // slots and divide by 16. For 2H / ranged wielders (no offhand) the
  // mainhand counts double, occupying the phantom offhand slot. Don't
  // round — fractional precision feeds the home page Top iLvl panel and
  // the max-with-RIO comparison.
  //
  // The previous implementation did `Math.round(sum / items.length)`,
  // which silently lost decimals AND divided 2H wielders by 15 instead
  // of 16 — the source of the "everyone's a clean integer" artifact on
  // DKs, BM Hunters, Ret Pallies, etc.
  let sum = 0;
  let mainhandIlvl = 0;
  let hasOffhand = false;
  for (const it of items) {
    sum += it.itemLevel;
    if (it.slot === "mainhand") mainhandIlvl = it.itemLevel;
    if (it.slot === "offhand") hasOffhand = true;
  }
  if (!hasOffhand && mainhandIlvl > 0) sum += mainhandIlvl;
  const ilvl = items.length > 0 ? sum / 16 : 0;
  return { items, ilvl };
}

export async function getCharacterAchievements(
  realmSlug: string,
  characterName: string,
): Promise<AchievementSummary | null> {
  type RawAch = {
    total_quantity?: number;
    total_points?: number;
    recent_events?: { achievement: { id: number; name: string }; timestamp: number }[];
    category_progress?: {
      category: { id: number; name: string };
      quantity: number;
      points: number;
    }[];
  };
  const lc = characterName.toLowerCase();
  return memo(`ach:${realmSlug}:${lc}`, 3600 * 1000, async () => {
    const data = (await bnetFetch(
      `/profile/wow/character/${realmSlug}/${lc}/achievements`,
      { skipNextCache: true },
    )) as RawAch | null;
    if (!data) return null;
    return {
      totalQuantity: data.total_quantity ?? 0,
      totalPoints: data.total_points ?? 0,
      recent: (data.recent_events ?? []).slice(0, 10).map((r) => ({
        id: r.achievement.id,
        name: r.achievement.name,
        timestamp: r.timestamp,
      })),
      topCategories: [...(data.category_progress ?? [])]
        .sort((a, b) => b.points - a.points)
        .slice(0, 10)
        .map((c) => ({
          id: c.category.id,
          name: c.category.name,
          quantity: c.quantity,
          points: c.points,
        })),
    };
  });
}

/**
 * Patterns that mark a recent achievement as "notable" — the kind worth
 * surfacing on the home page activity feed. Filters out levelling, exploration,
 * and quest-line achievements which dominate raw `recent_events`.
 */
const NOTABLE_ACHIEVEMENT_PATTERNS: RegExp[] = [
  /Ahead of the Curve/i,
  /Cutting Edge/i,
  /Hall of Fame/i,
  /^Mythic:/,
  /^Heroic:/,
  /Glory of the/i,
  /Keystone Master/i,
  /Keystone Hero/i,
  /Keystone Legend/i,
];

export type CharacterTierData = {
  tierBadges: RaidTierBadges;
  notableRecent: { id: number; name: string; timestamp: number }[];
};

/**
 * Per-character data derived from the BNet achievements endpoint, used both
 * for the character detail page (tier badges) and the home-page activity
 * feed (notable recent achievements). Combined into one function so a single
 * cache entry serves both consumers.
 *
 * `finalBoss` matches AOTC / Cutting Edge / Hall of Fame achievements by
 * substring (e.g. "Sols, the Burning Sun"). When empty, badges are skipped.
 *
 * The achievements endpoint exceeds Next.js's 2MB fetch-cache limit, so we
 * shape down and memoize the result for 24 h. Badges and notable
 * achievements rarely change — the longer TTL keeps repeat snapshot
 * rebuilds free.
 */
export async function getCharacterTierData(
  realmSlug: string,
  characterName: string,
  finalBoss: string,
): Promise<CharacterTierData | null> {
  type Raw = {
    achievements?: {
      achievement?: { name?: string };
      completed_timestamp?: number;
    }[];
    recent_events?: {
      achievement: { id: number; name: string };
      timestamp: number;
    }[];
  };
  const lc = characterName.toLowerCase();
  return memo(
    `tier-data:${realmSlug}:${lc}:${finalBoss}`,
    24 * 3600 * 1000,
    async () => {
      const data = (await bnetFetch(
        `/profile/wow/character/${realmSlug}/${lc}/achievements`,
        { skipNextCache: true },
      )) as Raw | null;
      if (!data) return null;

      // Two detection modes:
      //   - Strict (finalBoss set): match achievements whose name includes
      //     the configured final-boss substring. Used when the in-game
      //     achievement boss name diverges from the RIO encounter name
      //     (e.g. Midnight tier — RIO says "Midnight Falls" but the
      //     achievement says "Sols, the Burning Sun").
      //   - Auto (finalBoss empty): match any AOTC/CE/HoF achievement
      //     earned within TIER_BADGE_RECENCY_DAYS. Lets new tiers light up
      //     badges with no config — see CURRENT_TIER_FINAL_BOSS in
      //     lib/config.ts for the trade-off near tier transitions.
      const tierBadges: RaidTierBadges = {};
      const recencyCutoff =
        Date.now() - TIER_BADGE_RECENCY_DAYS * 24 * 60 * 60 * 1000;
      for (const entry of data.achievements ?? []) {
        const name = entry.achievement?.name ?? "";
        const ts = entry.completed_timestamp;
        if (!ts) continue;
        if (finalBoss) {
          if (!name.includes(finalBoss)) continue;
        } else {
          if (ts < recencyCutoff) continue;
        }
        if (name.startsWith("Ahead of the Curve:")) tierBadges.aotc = ts;
        else if (name.startsWith("Cutting Edge:")) tierBadges.ce = ts;
        else if (name.startsWith("Hall of Fame:")) tierBadges.hof = ts;
      }

      const notableRecent = (data.recent_events ?? [])
        .filter((e) =>
          NOTABLE_ACHIEVEMENT_PATTERNS.some((p) =>
            p.test(e.achievement?.name ?? ""),
          ),
        )
        .map((e) => ({
          id: e.achievement.id,
          name: e.achievement.name,
          timestamp: e.timestamp,
        }));

      return { tierBadges, notableRecent };
    },
  );
}

export async function getCharacterCollections(
  realmSlug: string,
  characterName: string,
): Promise<CollectionsSummary | null> {
  type ListResponse = { mounts?: unknown[]; pets?: unknown[] };
  const lc = characterName.toLowerCase();
  const [mounts, pets] = await Promise.all([
    bnetFetch(
      `/profile/wow/character/${realmSlug}/${lc}/collections/mounts`,
    ) as Promise<ListResponse | null>,
    bnetFetch(
      `/profile/wow/character/${realmSlug}/${lc}/collections/pets`,
    ) as Promise<ListResponse | null>,
  ]);
  if (!mounts && !pets) return null;
  return {
    mountCount: mounts?.mounts?.length ?? 0,
    petCount: pets?.pets?.length ?? 0,
  };
}

export async function getGuildRaidHistory(
  realmSlug: string,
  guildName: string,
): Promise<RawRaidClear[]> {
  // Achievement names follow:
  //   "{Raid Name} Guild Run"          -> Normal clear
  //   "Heroic: {Raid Name} Guild Run"  -> Heroic clear
  //   "Heroic {Raid Name} Guild Run"   -> Heroic clear (some old achievements omit colon)
  //   Blizzard doesn't have a Mythic Guild Run achievement, so M is unrepresented here.
  type Raw = {
    achievements?: {
      achievement?: { name?: string };
      completed_timestamp?: number;
    }[];
  };
  const slug = guildName.toLowerCase().replace(/\s+/g, "-");
  return memo(`raidhist:${realmSlug}:${slug}`, 6 * 3600 * 1000, async () => {
    const data = (await bnetFetch(
      `/data/wow/guild/${realmSlug}/${slug}/achievements`,
      { skipNextCache: true },
    )) as Raw | null;
    if (!data) return [];
    const out: RawRaidClear[] = [];
    for (const a of data.achievements ?? []) {
      const name = a.achievement?.name ?? "";
      const completed = a.completed_timestamp ?? 0;
      if (!completed || !name.endsWith(" Guild Run")) continue;
      const stripped = name.slice(0, -" Guild Run".length);
      let difficulty: RawRaidClear["difficulty"];
      let raidName: string;
      if (/^Heroic[:\s]/.test(stripped)) {
        difficulty = "Heroic";
        raidName = stripped.replace(/^Heroic[:\s]+/, "").trim();
      } else if (/^Mythic[:\s]/.test(stripped)) {
        difficulty = "Mythic";
        raidName = stripped.replace(/^Mythic[:\s]+/, "").trim();
      } else {
        difficulty = "Normal";
        raidName = stripped;
      }
      // Some categories are non-raid (5-mans). Filter using the assumption
      // that raid names tend to be longer multi-word phrases. This is a
      // heuristic but works for modern raids — RIO's static-data could
      // verify but adds complexity. Skip clearly-dungeon-named clears.
      out.push({ raidName, difficulty, completedAt: completed });
    }
    return out;
  }) as Promise<RawRaidClear[]>;
}

// Boss creature portraits — same encounter ID always maps to the same image.
// Cache forever (until process restart).
const encounterIconCache = new Map<number, string | null>();

export async function getEncounterIconUrl(
  encounterId: number,
): Promise<string | null> {
  if (encounterIconCache.has(encounterId)) {
    return encounterIconCache.get(encounterId) ?? null;
  }
  type Resp = { creatures?: { creature_display?: { id?: number } }[] };
  const data = (await bnetFetch(
    `/data/wow/journal-encounter/${encounterId}`,
    { namespace: `static-${REGION}` },
  )) as Resp | null;
  const cdid = data?.creatures?.[0]?.creature_display?.id;
  const url = cdid
    ? `https://render.worldofwarcraft.com/${REGION}/npcs/zoom/creature-display-${cdid}.jpg`
    : null;
  // Only cache hits — see spellIconCache for context on why caching null
  // on transient failures causes sticky empty-icon bugs.
  if (url) encounterIconCache.set(encounterId, url);
  return url;
}

// BNet instance index — name → instance ID. Refreshed weekly.
const instanceIndexCache: {
  value: Map<string, number> | null;
  expiresAt: number;
} = { value: null, expiresAt: 0 };

async function getInstanceIdByName(name: string): Promise<number | null> {
  if (
    !instanceIndexCache.value ||
    instanceIndexCache.expiresAt < Date.now()
  ) {
    type Resp = { instances?: { id: number; name: string }[] };
    const data = (await bnetFetch(`/data/wow/journal-instance/index`, {
      namespace: `static-${REGION}`,
    })) as Resp | null;
    const map = new Map<string, number>();
    for (const inst of data?.instances ?? []) {
      if (inst.name) map.set(inst.name.toLowerCase(), inst.id);
    }
    instanceIndexCache.value = map;
    instanceIndexCache.expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  }
  return instanceIndexCache.value.get(name.toLowerCase()) ?? null;
}

// Per-instance encounter list cache.
const instanceEncountersCache = new Map<number, { id: number; name: string }[]>();

async function getInstanceEncounters(
  instanceId: number,
): Promise<{ id: number; name: string }[]> {
  if (instanceEncountersCache.has(instanceId)) {
    return instanceEncountersCache.get(instanceId)!;
  }
  type Resp = { encounters?: { id: number; name: string }[] };
  const data = (await bnetFetch(
    `/data/wow/journal-instance/${instanceId}`,
    { namespace: `static-${REGION}` },
  )) as Resp | null;
  const encs = data?.encounters ?? [];
  instanceEncountersCache.set(instanceId, encs);
  return encs;
}

/**
 * For a raid identified by display name, return BNet's instance tile URL
 * (a wide raid banner). Falls back to null if the raid isn't in BNet's
 * journal index. Used by raid history to provide icons for pre-Legion
 * raids that Raider.IO's static-data doesn't index.
 */
export async function getRaidTileUrlByName(
  raidName: string,
): Promise<string | null> {
  const instanceId = await getInstanceIdByName(raidName);
  if (!instanceId) return null;
  return getInstanceTileUrl(instanceId);
}

/**
 * Normalize a boss/encounter name to a key that's robust to RIO ↔ BNet
 * naming differences (hyphens, ampersands, apostrophes, commas, prefix
 * articles, case). RIO humanizes slugs like "vaelgor-ezzorak" to "Vaelgor
 * Ezzorak"; BNet's official name for the same encounter is "Vaelgor &
 * Ezzorak". Stripping everything non-alphanumeric collapses both to
 * "vaelgorezzorak" so the icon lookup succeeds regardless.
 *
 * Exported so consumers (raiderio.ts, populate script) can use the same
 * key when reading from the resolved icon map.
 */
export function normalizeBossNameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // strip all punctuation + whitespace
}

/**
 * For a raid identified by its display name, return a map of boss-name →
 * portrait icon URL (BNet creature display). Used by getPastRaidDetail to
 * stamp icons onto bosses sourced from Raider.IO (whose encounter IDs
 * don't match BNet's).
 */
export async function resolveRaidBossIcons(
  raidName: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const instanceId = await getInstanceIdByName(raidName);
  if (!instanceId) return result;
  const encounters = await getInstanceEncounters(instanceId);
  await Promise.all(
    encounters.map(async (enc) => {
      const url = await getEncounterIconUrl(enc.id);
      if (url) result.set(normalizeBossNameKey(enc.name), url);
    }),
  );
  return result;
}

// Instance tile image URLs are static metadata — cache aggressively.
const instanceTileCache = new Map<number, string | null>();

async function getInstanceTileUrl(instanceId: number): Promise<string | null> {
  if (instanceTileCache.has(instanceId)) {
    return instanceTileCache.get(instanceId) ?? null;
  }
  type Media = { assets?: { key?: string; value?: string }[] };
  const media = (await bnetFetch(`/data/wow/media/journal-instance/${instanceId}`, {
    namespace: `static-${REGION}`,
  })) as Media | null;
  // Prefer the "tile" asset; fall back to the first one.
  const url =
    media?.assets?.find((a) => a.key === "tile")?.value ??
    media?.assets?.[0]?.value ??
    null;
  if (url) instanceTileCache.set(instanceId, url);
  return url;
}

export async function getCharacterRaidEncounters(
  realmSlug: string,
  characterName: string,
): Promise<RaidEncountersData | null> {
  type RawEncounter = {
    encounter: { id: number; name: string };
    completed_count: number;
    last_kill_timestamp: number;
  };
  type RawMode = {
    difficulty: { type: string };
    progress?: { encounters?: RawEncounter[] };
  };
  type RawInstance = {
    instance: { id: number; name: string };
    modes?: RawMode[];
  };
  type RawExpansion = {
    expansion: { id?: number; name: string };
    instances?: RawInstance[];
  };
  type RawResp = { expansions?: RawExpansion[] };

  const data = (await bnetFetch(
    `/profile/wow/character/${realmSlug}/${characterName.toLowerCase()}/encounters/raids`,
  )) as RawResp | null;
  if (!data?.expansions?.length) return null;

  // BNet's expansions array isn't chronologically ordered. Their special
  // "Current Season" entry aggregates BOTH the previous tier and the current
  // expansion (e.g. Manaforge Omega + Midnight tier together) which isn't
  // what we want — we want the current expansion only. Pick the entry with
  // the highest expansion ID, ignoring "Current Season". This auto-rolls
  // when new expansions launch since BNet assigns sequential IDs.
  const expansions = data.expansions;
  const ranked = [...expansions]
    .filter((e) => e.expansion?.name !== "Current Season")
    .sort((a, b) => (b.expansion?.id ?? 0) - (a.expansion?.id ?? 0));
  const exp =
    ranked[0] ??
    expansions.find((e) => e.expansion?.name === "Current Season") ??
    expansions[expansions.length - 1];
  if (!exp) return null;

  const allowed: RaidDifficulty[] = ["LFR", "NORMAL", "HEROIC", "MYTHIC"];
  const rawInstances = (exp.instances ?? []).map((inst) => {
    const byEncounter = new Map<number, RaidEncounterRow>();
    for (const mode of inst.modes ?? []) {
      const diff = mode.difficulty?.type as RaidDifficulty;
      if (!allowed.includes(diff)) continue;
      for (const enc of mode.progress?.encounters ?? []) {
        let row = byEncounter.get(enc.encounter.id);
        if (!row) {
          row = {
            encounterId: enc.encounter.id,
            encounterName: enc.encounter.name,
            perDifficulty: {},
          };
          byEncounter.set(enc.encounter.id, row);
        }
        row.perDifficulty[diff] = {
          count: enc.completed_count,
          lastKillTimestamp: enc.last_kill_timestamp,
        };
      }
    }
    return {
      instanceId: inst.instance.id,
      instanceName: inst.instance.name,
      encounters: Array.from(byEncounter.values()),
    };
  });

  // Resolve tile URLs + per-encounter boss icons in parallel.
  const instances = await Promise.all(
    rawInstances.map(async (inst) => {
      const [tileUrl, ...encounterIcons] = await Promise.all([
        getInstanceTileUrl(inst.instanceId),
        ...inst.encounters.map((e) => getEncounterIconUrl(e.encounterId)),
      ]);
      const encounters = inst.encounters.map((e, i) => ({
        ...e,
        iconUrl: encounterIcons[i] ?? undefined,
      }));
      return {
        ...inst,
        tileUrl: tileUrl ?? undefined,
        encounters,
      };
    }),
  );

  return {
    expansionName: exp.expansion.name,
    instances,
  };
}

type RaidEncounterRow = {
  encounterId: number;
  encounterName: string;
  perDifficulty: Partial<
    Record<RaidDifficulty, { count: number; lastKillTimestamp: number }>
  >;
};

export async function getCharacterPvp(
  realmSlug: string,
  characterName: string,
): Promise<PvpSummary | null> {
  type RawPvp = {
    honor_level?: number;
    honorable_kills?: number;
    brackets?: { href?: string }[];
  };
  type RawBracket = {
    bracket?: { type?: string };
    rating?: number;
    season_match_statistics?: { played?: number; won?: number; lost?: number };
  };
  const lc = characterName.toLowerCase();
  const summary = (await bnetFetch(
    `/profile/wow/character/${realmSlug}/${lc}/pvp-summary`,
  )) as RawPvp | null;
  if (!summary) return null;

  const brackets: { bracket: string; rating: number; seasonMatchStatistics?: RawBracket["season_match_statistics"] }[] =
    [];
  for (const b of summary.brackets ?? []) {
    if (!b.href) continue;
    try {
      const token = await getToken();
      if (!token) break;
      const res = await fetch(b.href, {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 3600 },
      });
      if (!res.ok) continue;
      const bd: RawBracket = await res.json();
      if (bd.bracket?.type) {
        brackets.push({
          bracket: bd.bracket.type,
          rating: bd.rating ?? 0,
          seasonMatchStatistics: bd.season_match_statistics,
        });
      }
    } catch {
      // skip
    }
  }

  return {
    honorLevel: summary.honor_level ?? 0,
    honorableKills: summary.honorable_kills ?? 0,
    brackets,
  };
}

// Spell icon URLs by spell ID — cached forever, talents share spells across
// characters so the cache pays off quickly.
const spellIconCache = new Map<number, string | null>();

async function getSpellIconUrl(spellId: number): Promise<string | null> {
  if (spellIconCache.has(spellId)) return spellIconCache.get(spellId) ?? null;
  type Resp = { assets?: { key?: string; value?: string }[] };
  const data = (await bnetFetch(`/data/wow/media/spell/${spellId}`, {
    namespace: `static-${REGION}`,
  })) as Resp | null;
  const url =
    data?.assets?.find((a) => a.key === "icon")?.value ??
    data?.assets?.[0]?.value ??
    null;
  // Only cache hits. Caching null on transient failures (BNet rate limit,
  // serverless function timeout truncating mid-fanout) was sticky — once
  // a spell got cached as null, every subsequent render rendered an empty
  // talent icon for it. Letting nulls retry is cheap (1 BNet call on the
  // next render) and avoids the partial-icon bug.
  if (url) spellIconCache.set(spellId, url);
  return url;
}

// Talent tree node maps (class + spec + hero nodes from one spec tree fetch).
type TreeNode = {
  id?: number;
  display_row?: number;
  display_col?: number;
  ranks?: {
    rank?: number;
    tooltip?: { spell_tooltip?: { spell?: { id?: number; name?: string } } };
    choice_of_tooltips?: {
      spell_tooltip?: { spell?: { id?: number; name?: string } };
    }[];
  }[];
};
type ResolvedTrees = {
  class: Map<number, TreeNode>;
  spec: Map<number, TreeNode>;
  /** Hero talents keyed by hero tree name */
  heroByName: Map<string, Map<number, TreeNode>>;
};
const treeCache = new Map<string, ResolvedTrees>();

function pathFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

async function getResolvedTrees(
  specTreeHref: string,
): Promise<ResolvedTrees | null> {
  const path = pathFromUrl(specTreeHref);
  if (treeCache.has(path)) return treeCache.get(path)!;
  type Resp = {
    class_talent_nodes?: TreeNode[];
    spec_talent_nodes?: TreeNode[];
    hero_talent_trees?: {
      id?: number;
      name?: string;
      hero_talent_nodes?: TreeNode[];
    }[];
  };
  const data = (await bnetFetch(path, {
    namespace: `static-${REGION}`,
  })) as Resp | null;
  if (!data) return null;
  const indexBy = (nodes: TreeNode[] | undefined) => {
    const m = new Map<number, TreeNode>();
    for (const n of nodes ?? []) if (n.id != null) m.set(n.id, n);
    return m;
  };
  const heroByName = new Map<string, Map<number, TreeNode>>();
  for (const ht of data.hero_talent_trees ?? []) {
    if (ht.name) heroByName.set(ht.name, indexBy(ht.hero_talent_nodes));
  }
  const result: ResolvedTrees = {
    class: indexBy(data.class_talent_nodes),
    spec: indexBy(data.spec_talent_nodes),
    heroByName,
  };
  treeCache.set(path, result);
  return result;
}

function spellInfoFromNode(
  node: TreeNode | undefined,
): { spellId: number; name: string } | null {
  if (!node?.ranks?.length) return null;
  const r = node.ranks[0];
  // Choice nodes don't have a single tooltip — without knowing which option
  // the player picked we just take the first choice. Most nodes aren't
  // choice nodes so this is an acceptable approximation.
  const spell =
    r.tooltip?.spell_tooltip?.spell ??
    r.choice_of_tooltips?.[0]?.spell_tooltip?.spell;
  if (!spell?.id) return null;
  return { spellId: spell.id, name: spell.name ?? "" };
}

// Spec icon lookup (cached forever — they don't change).
const specIconCache = new Map<number, string | null>();

async function getSpecIconUrl(specId: number): Promise<string | null> {
  if (specIconCache.has(specId)) return specIconCache.get(specId) ?? null;
  type Resp = { assets?: { key?: string; value?: string }[] };
  const data = (await bnetFetch(
    `/data/wow/media/playable-specialization/${specId}`,
    { namespace: `static-${REGION}` },
  )) as Resp | null;
  const url =
    data?.assets?.find((a) => a.key === "icon")?.value ??
    data?.assets?.[0]?.value ??
    null;
  if (url) specIconCache.set(specId, url);
  return url;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type RawSelected = { id?: number; rank?: number };
type RawHeroTree = { id?: number; name?: string };
type RawLoadout = {
  is_active?: boolean;
  talent_loadout_code?: string;
  selected_hero_talent_tree?: RawHeroTree;
  selected_class_talents?: RawSelected[];
  selected_spec_talents?: RawSelected[];
  selected_hero_talents?: RawSelected[];
};
type RawSpec = {
  specialization?: { id?: number; name?: string };
  loadouts?: RawLoadout[];
};
type RawSpecsResp = {
  active_specialization?: { id?: number; name?: string };
  specializations?: RawSpec[];
  character?: {
    character_class?: { id?: number; name?: string };
  };
};

async function buildSelectedTalent(
  sel: RawSelected,
  nodeMap: Map<number, TreeNode>,
): Promise<SelectedTalent | null> {
  if (sel.id == null) return null;
  const node = nodeMap.get(sel.id);
  if (!node) return null;
  const spell = spellInfoFromNode(node);
  if (!spell) return null;
  const iconUrl = await getSpellIconUrl(spell.spellId);
  return {
    nodeId: sel.id,
    spellId: spell.spellId,
    name: spell.name,
    iconUrl: iconUrl ?? "",
    rank: sel.rank ?? 0,
    maxRanks: node.ranks?.length ?? 1,
    row: node.display_row ?? 0,
    col: node.display_col ?? 0,
  };
}

/** Resolves one loadout's class/spec/hero talent arrays. Shared between
 *  the active-spec path in getCharacterTalents and the lazy single-spec
 *  path in getCharacterSpecTalents. */
async function resolveLoadoutTalents(
  loadout: RawLoadout,
): Promise<{
  classTalents: SelectedTalent[];
  specTalents: SelectedTalent[];
  heroTalents: SelectedTalent[];
} | null> {
  const specTreeHref = (
    loadout as unknown as {
      selected_spec_talent_tree?: { key?: { href?: string } };
    }
  ).selected_spec_talent_tree?.key?.href;
  if (!specTreeHref) return null;
  const trees = await getResolvedTrees(specTreeHref);
  if (!trees) return null;
  const dedupe = (arr: (SelectedTalent | null)[]): SelectedTalent[] => {
    const seen = new Set<number>();
    const out: SelectedTalent[] = [];
    for (const t of arr) {
      if (!t || seen.has(t.nodeId)) continue;
      seen.add(t.nodeId);
      out.push(t);
    }
    return out;
  };
  const heroName = loadout.selected_hero_talent_tree?.name;
  const heroNodes =
    (heroName && trees.heroByName.get(heroName)) ||
    new Map<number, TreeNode>();
  const [classTalents, specTalents, heroTalents] = await Promise.all([
    Promise.all(
      (loadout.selected_class_talents ?? []).map((t) =>
        buildSelectedTalent(t, trees.class),
      ),
    ),
    Promise.all(
      (loadout.selected_spec_talents ?? []).map((t) =>
        buildSelectedTalent(t, trees.spec),
      ),
    ),
    Promise.all(
      (loadout.selected_hero_talents ?? []).map((t) =>
        buildSelectedTalent(t, heroNodes),
      ),
    ),
  ]);
  return {
    classTalents: dedupe(classTalents),
    specTalents: dedupe(specTalents),
    heroTalents: dedupe(heroTalents),
  };
}

export async function getCharacterTalents(
  realmSlug: string,
  characterName: string,
): Promise<TalentLoadout | null> {
  const data = (await bnetFetch(
    `/profile/wow/character/${realmSlug}/${characterName.toLowerCase()}/specializations`,
  )) as RawSpecsResp | null;
  if (!data) return null;
  const activeId = data.active_specialization?.id ?? 0;
  const className = data.character?.character_class?.name ?? "Unknown";

  // Only resolve full talent arrays for the ACTIVE spec server-side.
  // Off-specs return with classTalents/specTalents/heroTalents undefined;
  // the client lazy-fetches them via /api/talents/<realm>/<name>/<specId>
  // when the user expands the off-spec card. Cuts cold-cache talent
  // resolution from ~240 BNet calls to ~80 for a 3-spec character.
  const specs: TalentSpec[] = await Promise.all(
    (data.specializations ?? []).map(async (s) => {
      const specId = s.specialization?.id ?? 0;
      const specName = s.specialization?.name ?? "Unknown";
      const isActive = specId === activeId;
      const loadout =
        s.loadouts?.find((l) => l.is_active) ?? s.loadouts?.[0];
      const heroTree = loadout?.selected_hero_talent_tree;
      const iconUrl = (await getSpecIconUrl(specId)) ?? undefined;

      const base: TalentSpec = {
        specId,
        specName,
        specSlug: slugify(specName),
        isActive,
        heroTalentName: heroTree?.name,
        heroTalentSlug: heroTree?.name ? slugify(heroTree.name) : undefined,
        iconUrl,
        loadoutCode: loadout?.talent_loadout_code,
      };

      if (isActive && loadout) {
        const resolved = await resolveLoadoutTalents(loadout);
        if (resolved) {
          base.classTalents = resolved.classTalents;
          base.specTalents = resolved.specTalents;
          base.heroTalents = resolved.heroTalents;
        }
      }
      return base;
    }),
  );

  return {
    classSlug: slugify(className),
    className,
    activeSpecId: activeId,
    specs,
  };
}

/** Resolves one specific spec's talent arrays for lazy off-spec loading.
 *  Hit by /api/talents/[realm]/[name]/[specId] when the client expands
 *  an off-spec card whose talents weren't included in the initial render. */
export async function getCharacterSpecTalents(
  realmSlug: string,
  characterName: string,
  specId: number,
): Promise<{
  classTalents: SelectedTalent[];
  specTalents: SelectedTalent[];
  heroTalents: SelectedTalent[];
  loadoutCode?: string;
} | null> {
  const data = (await bnetFetch(
    `/profile/wow/character/${realmSlug}/${characterName.toLowerCase()}/specializations`,
  )) as RawSpecsResp | null;
  if (!data) return null;
  const target = data.specializations?.find(
    (s) => s.specialization?.id === specId,
  );
  if (!target) return null;
  const loadout =
    target.loadouts?.find((l) => l.is_active) ?? target.loadouts?.[0];
  if (!loadout) return null;
  const resolved = await resolveLoadoutTalents(loadout);
  if (!resolved) return null;
  return { ...resolved, loadoutCode: loadout.talent_loadout_code };
}

export async function getCharacterStats(
  realmSlug: string,
  characterName: string,
): Promise<CharacterStats | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const url =
      `${API_BASE}/profile/wow/character/${realmSlug}/${characterName.toLowerCase()}` +
      `/statistics?namespace=${NAMESPACE}&locale=${LOCALE}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      if (res.status !== 404) {
        console.error("[bnet] stats failed:", res.status, characterName);
      }
      return null;
    }
    const s: BnetStatsResponse = await res.json();
    const primary = pickPrimary(s);
    // For crit/haste, prefer spell value for casters (highest int) else melee.
    const isCaster = primary.label === "Intellect";
    const crit = pctValue(isCaster ? s.spell_crit : s.melee_crit);
    const haste = pctValue(isCaster ? s.spell_haste : s.melee_haste);
    return {
      health: s.health ?? 0,
      power: s.power,
      powerType: s.power_type?.name,
      primaryStatLabel: primary.label,
      primaryStatValue: primary.value,
      stamina: s.stamina?.effective ?? 0,
      crit,
      critRating: ratingNormalized(isCaster ? s.spell_crit : s.melee_crit),
      haste,
      hasteRating: ratingNormalized(isCaster ? s.spell_haste : s.melee_haste),
      mastery: pctValue(s.mastery),
      masteryRating: ratingNormalized(s.mastery),
      versatility: s.versatility_damage_done_bonus ?? 0,
      versatilityRating: typeof s.versatility === "number" ? s.versatility : 0,
      avoidance: pctRatingBonus(s.avoidance),
      avoidanceRating: ratingNormalized(s.avoidance),
      leech: pctValue(s.lifesteal),
      leechRating: ratingNormalized(s.lifesteal),
      speed: pctRatingBonus(s.speed),
      speedRating: ratingNormalized(s.speed),
    };
  } catch (e) {
    console.error("[bnet] stats error:", e);
    return null;
  }
}
