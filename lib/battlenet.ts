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
  CharacterSeasonTitle,
  SelectedTalent,
  TalentLoadout,
  TalentSpec,
} from "./types";
import { CURRENT_TIER_FINAL_BOSS, TIER_BADGE_RECENCY_DAYS } from "./config";

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
    // Token reuse is handled by the in-memory tokenCache above (keyed on its
    // own expiry). We deliberately do NOT mark this no-store: a no-store fetch
    // anywhere in a render path forces the whole route dynamic, which blocked
    // ISR on the character pages (the top Vercel Active-CPU driver). It's a
    // POST, so Next never data-caches it regardless — this directive only
    // keeps the route static-eligible.
    next: { revalidate: 3600 },
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
  // 1h Next.js fetch cache (the bnetFetch default). Equipment was formerly
  // no-store for maximum gear freshness, but that forced every character page
  // to render live on each hit — crawlers hammering ~125 character URLs was
  // the top driver of Vercel Active CPU. Blizzard's armory itself lags
  // 5min–days, and RIO/BNet only commit gear on logout / instance completion
  // (M+ run or raid boss kill), so a 1h window is no meaningfully staler while
  // letting the character page cache (ISR) instead of recomputing per request.
  const data = (await bnetFetch(
    `/profile/wow/character/${realmSlug}/${lc}/equipment`,
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

type RawAchievements = {
  total_quantity?: number;
  total_points?: number;
  recent_events?: {
    achievement: { id: number; name: string };
    timestamp: number;
  }[];
  category_progress?: {
    category: { id: number; name: string };
    quantity: number;
    points: number;
  }[];
  achievements?: {
    achievement?: { name?: string };
    completed_timestamp?: number;
  }[];
};

type CombinedAchievements = {
  summary: AchievementSummary;
  tierData: CharacterTierData;
};

/**
 * Single source for everything we derive from BNet's ~2.67MB /achievements
 * blob. The character page needs BOTH the achievements-tab summary AND the
 * tier badges / season titles; previously each was its own function with its
 * own fetch, so that blob was downloaded and JSON-parsed TWICE per render.
 * Fetching + parsing it once here halves the per-render achievements cost.
 * Memoised by character + finalBoss, and the memo's in-flight dedup means the
 * detail page's concurrent Promise.all (summary + tier data) shares one fetch.
 *
 * (The response exceeds Next's 2MB fetch-cache limit, so the raw blob itself
 * is never data-cached — but the small derived result is held in this memo,
 * and the character page is ISR-cached, so the blob is only parsed on a cold
 * regeneration, ~once per character per hour.)
 */
async function getCombinedAchievements(
  realmSlug: string,
  characterName: string,
  finalBoss: string,
): Promise<CombinedAchievements | null> {
  const lc = characterName.toLowerCase();
  return memo(
    `ach-combined:${realmSlug}:${lc}:${finalBoss}`,
    3600 * 1000,
    async () => {
      const data = (await bnetFetch(
        `/profile/wow/character/${realmSlug}/${lc}/achievements`,
      )) as RawAchievements | null;
      if (!data) return null;

      // ---- achievements-tab summary ----
      const summary: AchievementSummary = {
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

      // ---- tier badges + season titles (full achievement-list scan) ----
      const tierBadges: RaidTierBadges = {};
      const titlesBySeason = new Map<string, CharacterSeasonTitle>();
      // Hero (0.1%) outranks Champion (1%) for the same season — a top-0.1%
      // holder earns both, but we show only the gold star.
      const titleRank = (t: CharacterSeasonTitle) =>
        t.tier === "champion" ? 0 : 1;
      const recencyCutoff =
        Date.now() - TIER_BADGE_RECENCY_DAYS * 24 * 60 * 60 * 1000;
      for (const entry of data.achievements ?? []) {
        const name = entry.achievement?.name ?? "";
        const ts = entry.completed_timestamp;
        if (!ts) continue;
        const parsedTitle = parseSeasonTitle(name, ts);
        if (parsedTitle) {
          const prior = titlesBySeason.get(parsedTitle.season);
          if (
            !prior ||
            titleRank(parsedTitle) > titleRank(prior) ||
            (titleRank(parsedTitle) === titleRank(prior) &&
              ts > prior.earnedAt)
          ) {
            titlesBySeason.set(parsedTitle.season, parsedTitle);
          }
        }
        if (finalBoss) {
          if (!name.includes(finalBoss)) continue;
        } else {
          if (ts < recencyCutoff) continue;
        }
        if (name.startsWith("Ahead of the Curve:")) tierBadges.aotc = ts;
        else if (name.startsWith("Cutting Edge:")) tierBadges.ce = ts;
        else if (name.startsWith("Hall of Fame:")) tierBadges.hof = ts;
      }

      // Every recent achievement the character earned — not just "notable"
      // raid/M+ wins. Members want to see the full list of what they did, so
      // the home feed surfaces all of these and just tags the standout ones
      // (raid kills, Keystone Master/Hero/Legend, Glory metas). BNet caps
      // recent_events at ~10 per character, so this is the latest handful.
      const recentEarned = (data.recent_events ?? []).map((e) => ({
        id: e.achievement.id,
        name: e.achievement.name,
        timestamp: e.timestamp,
      }));

      const seasonTitles = [...titlesBySeason.values()].sort(
        (a, b) => b.earnedAt - a.earnedAt,
      );

      return {
        summary,
        tierData: { tierBadges, recentEarned, seasonTitles },
      };
    },
  );
}

export async function getCharacterAchievements(
  realmSlug: string,
  characterName: string,
): Promise<AchievementSummary | null> {
  // Shares the single /achievements fetch+parse with getCharacterTierData via
  // the combined memo (same finalBoss key as the detail page uses).
  const combined = await getCombinedAchievements(
    realmSlug,
    characterName,
    CURRENT_TIER_FINAL_BOSS,
  );
  return combined?.summary ?? null;
}

/**
 * Every earned achievement that carries a completion timestamp, as
 * {id, name, completedAt}. Unlike the 10-entry `recent_events` window, this is
 * the FULL history — so a diff-based consumer can catch up an arbitrarily long
 * backlog (e.g. after a stale-data freeze) instead of losing everything that
 * scrolled past the recent cap. Used by the #only-moo event poller.
 *
 * Fresh fetch (default 1h Next cache, but the 2.67MB blob exceeds the cache
 * limit so it's effectively uncached → fresh each call). Returns null on BNet
 * failure so the caller can skip without advancing its baseline.
 */
export async function getCharacterAchievementHistory(
  realmSlug: string,
  characterName: string,
): Promise<{ id: number; name: string; completedAt: number }[] | null> {
  type Entry = {
    id?: number;
    achievement?: { id?: number; name?: string };
    completed_timestamp?: number;
  };
  type Resp = { achievements?: Entry[] };
  const data = (await bnetFetch(
    `/profile/wow/character/${realmSlug}/${characterName.toLowerCase()}/achievements`,
  )) as Resp | null;
  if (!data?.achievements) return null;
  const out: { id: number; name: string; completedAt: number }[] = [];
  for (const a of data.achievements) {
    const id = a.achievement?.id ?? a.id;
    const name = a.achievement?.name;
    const ts = a.completed_timestamp;
    if (id != null && name && ts) out.push({ id, name, completedAt: ts });
  }
  return out;
}

export type CharacterTierData = {
  tierBadges: RaidTierBadges;
  /** Every achievement the character earned recently (BNet recent_events, the
   *  latest ~10), newest first. Feeds the home-page guild activity list, which
   *  tags the standout ones (raid kills, Keystone tiers, Glory metas). */
  recentEarned: { id: number; name: string; timestamp: number }[];
  /** Every Mythic+ end-of-season accolade this character has earned across
   *  their career, newest first — the player's "star collection". Each is
   *  either a top-0.1% Hero title or a top-1% Champion achievement (see
   *  SeasonTitleTier). Empty for the vast majority of characters. */
  seasonTitles: CharacterSeasonTitle[];
};

/**
 * Parse a Mythic+ end-of-season accolade achievement name into its display
 * parts, or return null if the name isn't one. Detects two tiers:
 *
 *   - HERO (top 0.1%) — the seasonal TITLE, named "<Adjective> Hero:
 *     <Expansion> Season <N>" (e.g. "Unbound Hero: The War Within Season
 *     Three"). Rendered "the <Adjective> Hero".
 *   - CHAMPION (top 1%) — the season-end achievement + mount (12.0.5+), named
 *     "<Adjective> Champion: <Expansion> Season <N>" (e.g. "Umbral Champion:
 *     Midnight Season One"). NOT a title, so no "the" article.
 *
 * Both require " <Rank>: " followed somewhere by " Season ", the invariant
 * across every season.
 *
 * Deliberately excluded:
 *   - "Keystone Hero/Master/Legend: …" (per-dungeon timing / rating rewards) —
 *     short-circuited by the "Keystone " guard.
 *   - "Hero of the Alliance/Horde: … Season …" and "Champion of the …:" (PvP —
 *     the word before ':' isn't the rank, so " Hero:"/" Champion:" never match).
 *   - PvP elite sets use "Gladiator", not "Champion", so they never match.
 *
 * Season-agnostic on purpose: callers take the NEWEST match, so the current
 * season always wins and next season rolls in with no code change.
 */
export function parseSeasonTitle(
  achievementName: string,
  earnedAt: number,
): CharacterSeasonTitle | null {
  if (!achievementName || achievementName.startsWith("Keystone ")) return null;

  const hero = achievementName.match(/^(.+?) Hero: (.+ Season .+)$/);
  if (hero) {
    const adjective = hero[1].trim();
    return {
      title: `the ${adjective} Hero`,
      name: `${adjective} Hero`,
      season: hero[2].trim(),
      earnedAt,
      tier: "hero",
    };
  }

  const champion = achievementName.match(/^(.+?) Champion: (.+ Season .+)$/);
  if (champion) {
    const adjective = champion[1].trim();
    return {
      title: `${adjective} Champion`,
      name: `${adjective} Champion`,
      season: champion[2].trim(),
      earnedAt,
      tier: "champion",
    };
  }

  return null;
}

/**
 * Per-character data derived from the BNet achievements endpoint, used both
 * for the character detail page (tier badges) and the home-page activity
 * feed (notable recent achievements). Thin wrapper over getCombinedAchievements
 * so it shares the single /achievements fetch+parse with the achievements-tab
 * summary instead of downloading the ~2.67MB blob a second time.
 *
 * `finalBoss` matches AOTC / Cutting Edge / Hall of Fame achievements by
 * substring (e.g. "Sols, the Burning Sun"). When empty, badges fall back to
 * any AOTC/CE/HoF earned within TIER_BADGE_RECENCY_DAYS.
 */
export async function getCharacterTierData(
  realmSlug: string,
  characterName: string,
  finalBoss: string,
): Promise<CharacterTierData | null> {
  const combined = await getCombinedAchievements(
    realmSlug,
    characterName,
    finalBoss,
  );
  return combined?.tierData ?? null;
}

/**
 * The character's current full-body render URL from BNet character-media —
 * `main-raw` (transparent PNG) if present, else `main`/`inset`. Reflects the
 * character's LIVE transmog, so callers never hardcode a render id that goes
 * stale the moment they remog. Returns null if the profile is private or BNet
 * is unavailable. Hosted on render.worldofwarcraft.com (CSP-whitelisted).
 */
export async function getCharacterRenderUrl(
  realmSlug: string,
  characterName: string,
): Promise<string | null> {
  const data = (await bnetFetch(
    `/profile/wow/character/${realmSlug}/${characterName.toLowerCase()}/character-media`,
  )) as { assets?: { key: string; value: string }[] } | null;
  const assets = data?.assets ?? [];
  const pick = (k: string) => assets.find((a) => a.key === k)?.value;
  return pick("main-raw") ?? pick("main") ?? pick("inset") ?? null;
}

export type DeathStats = {
  /** "Total deaths" — the headline career counter (null if absent). */
  total: number | null;
  /** Every death-flavored statistic by name → count: "Total deaths",
   *  "Deaths from falling", "Total deaths in delves", etc. Diff these over time
   *  to detect new deaths AND how they happened. */
  byName: Record<string, number>;
  /** Per-statistic last_updated_timestamp (ms) — lets callers drop counters
   *  Blizzard has abandoned (e.g. "Total deaths in raids" froze at 3 in Aug
   *  2025 and is NOT a real raid-death count). */
  updatedByName: Record<string, number>;
  /** Newest last_updated_timestamp across the death stats (ms), or null. */
  updatedAt: number | null;
};

/**
 * The character's death statistics from BNet's achievements/statistics endpoint
 * (WoW's in-game Statistics tab — NOT the combat stat-sheet /statistics). These
 * are cumulative counters that advance when Blizzard re-crawls the armory after
 * the character dies, so diffing them detects new deaths (and, via the
 * categorized sub-counters, roughly how they died). Returns null if the profile
 * is private or BNet is unavailable.
 */
export async function getCharacterDeathStats(
  realmSlug: string,
  characterName: string,
): Promise<DeathStats | null> {
  const data = (await bnetFetch(
    `/profile/wow/character/${realmSlug}/${characterName.toLowerCase()}/achievements/statistics`,
  )) as { categories?: unknown[] } | null;
  if (!data) return null;

  const byName: Record<string, number> = {};
  const updatedByName: Record<string, number> = {};
  let total: number | null = null;
  let updatedAt: number | null = null;

  type Stat = { name?: string; quantity?: number; last_updated_timestamp?: number };
  type Cat = { name?: string; statistics?: Stat[]; sub_categories?: Cat[] };
  const record = (s: Stat) => {
    if (!s?.name || typeof s.quantity !== "number") return;
    byName[s.name] = s.quantity;
    if (s.last_updated_timestamp) {
      updatedByName[s.name] = s.last_updated_timestamp;
      if (updatedAt === null || s.last_updated_timestamp > updatedAt)
        updatedAt = s.last_updated_timestamp;
    }
    if (/^total deaths$/i.test(s.name)) total = s.quantity;
  };
  const collect = (cat: Cat) => {
    (cat.statistics ?? []).forEach(record);
    (cat.sub_categories ?? []).forEach(collect);
  };

  // The whole "Deaths" category = death counters + resurrection-method counters
  // (Rebirthed by druids, Raised by death knights, Resurrected by soulstones…).
  // Grab the entire category so we capture all of it (and anything Blizzard adds).
  let deathsCat: Cat | null = null;
  const findDeaths = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(findDeaths);
      return;
    }
    const n = node as Cat;
    if (
      n.name === "Deaths" &&
      (Array.isArray(n.statistics) || Array.isArray(n.sub_categories))
    ) {
      deathsCat = n;
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") findDeaths(v);
    }
  };
  findDeaths(data.categories);

  if (deathsCat) {
    collect(deathsCat);
  } else {
    // Fallback: scan the whole tree for death-named counters (excludes boss
    // names that merely contain "Death").
    const DEATH_RE = /^(total deaths($| in )|deaths from )/i;
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const n = node as Stat;
      if (n.name && typeof n.quantity === "number" && DEATH_RE.test(n.name))
        record(n);
      for (const v of Object.values(node)) {
        if (v && typeof v === "object") walk(v);
      }
    };
    walk(data.categories);
  }
  return { total, byName, updatedByName, updatedAt };
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

/**
 * Lightweight cousin of `getCharacterRaidEncounters`: just the max
 * `last_kill_timestamp` across encounters in the named instances (current
 * tier's sub-raids). Skips icon/tile resolution so the snapshot fanout can
 * call this for every roster member without burning hundreds of extra fetches.
 *
 * `instanceNames` is the set of BNet instance display names to consider —
 * pass the current tier's sub-raid `bnetName`s. Returns 0 when no match.
 */
export async function getCharacterLastRaidKill(
  realmSlug: string,
  characterName: string,
  instanceNames: Set<string>,
): Promise<number> {
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

  // skipNextCache: the snapshot rebuild is the only caller, and it runs
  // hourly with the explicit goal of detecting "did this character raid
  // since the last snapshot." If we let Next.js's 1h fetch cache serve
  // a response captured before tonight's kill, we lose that detection —
  // the character keeps the stale timestamp until the cache TTL drops.
  // Source data freshness matters more than the few extra BNet calls.
  const data = (await bnetFetch(
    `/profile/wow/character/${realmSlug}/${characterName.toLowerCase()}/encounters/raids`,
    { skipNextCache: true },
  )) as RawResp | null;
  if (!data?.expansions?.length) return 0;
  let max = 0;
  for (const exp of data.expansions) {
    for (const inst of exp.instances ?? []) {
      if (!instanceNames.has(inst.instance.name)) continue;
      for (const mode of inst.modes ?? []) {
        for (const enc of mode.progress?.encounters ?? []) {
          if (enc.last_kill_timestamp > max) {
            max = enc.last_kill_timestamp;
          }
        }
      }
    }
  }
  return max;
}

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

/** A Mythic+ run pulled straight from Blizzard's keystone profile — the
 *  CURRENT weekly period's best run per dungeon. Used to surface a freshly-run
 *  key the instant Blizzard records it, instead of waiting hours for RIO's API
 *  to crawl the character (RIO's public API lags its own website). Carries the
 *  per-run Mythic+ rating, which in current WoW is the same number RIO shows. */
export type BnetKeystoneRun = {
  dungeon: string;
  dungeonId: number;
  level: number;
  completedAt: string; // ISO8601, to match RIO's MythicPlusRun.completedAt
  completedAtMs: number;
  clearTimeMs: number;
  /** 0 = depleted, 1/2/3 = +1/+2/+3 chests, derived from duration vs the
   *  dungeon's qualifying-time thresholds. Falls back to 1 for any in-time run
   *  if the thresholds can't be resolved. */
  upgrades: number;
  /** Blizzard's per-run Mythic+ rating (≈ RIO's per-run score). */
  score: number;
};

// Per-dungeon keystone upgrade thresholds (qualifying durations for +1/+2/+3),
// static data — cache forever within the lambda. Keyed by dungeon (challenge
// mode) id. Null-not-cached so a transient failure retries.
const keystoneUpgradeCache = new Map<
  number,
  { upgrade_level: number; qualifying_duration: number }[]
>();

async function getDungeonUpgradeThresholds(
  dungeonId: number,
): Promise<{ upgrade_level: number; qualifying_duration: number }[]> {
  const cached = keystoneUpgradeCache.get(dungeonId);
  if (cached) return cached;
  type Resp = {
    keystone_upgrades?: {
      upgrade_level?: number;
      qualifying_duration?: number;
    }[];
  };
  const data = (await bnetFetch(`/data/wow/mythic-keystone/dungeon/${dungeonId}`, {
    namespace: `dynamic-${REGION}`,
  })) as Resp | null;
  const thresholds = (data?.keystone_upgrades ?? [])
    .filter(
      (u): u is { upgrade_level: number; qualifying_duration: number } =>
        typeof u.upgrade_level === "number" &&
        typeof u.qualifying_duration === "number",
    )
    .map((u) => ({
      upgrade_level: u.upgrade_level,
      qualifying_duration: u.qualifying_duration,
    }));
  if (thresholds.length) keystoneUpgradeCache.set(dungeonId, thresholds);
  return thresholds;
}

/**
 * Pull a character's CURRENT-week Mythic+ runs directly from Blizzard's
 * mythic-keystone-profile (`current_period.best_runs` — Blizzard's best run per
 * dungeon for the active weekly affix period). This is the fast lane: Blizzard
 * records a run when it completes, so this sees a new key hours before RIO's
 * public API crawls the character. `skipNextCache` because freshness is the
 * entire point — a cached keystone profile would defeat the purpose.
 *
 * Returns [] for a character with no runs this week, null if BNet is
 * unavailable / the profile is private. Never throws (callers treat it as a
 * best-effort overlay on top of RIO data).
 */
export async function getCharacterKeystoneRuns(
  realmSlug: string,
  characterName: string,
): Promise<BnetKeystoneRun[] | null> {
  type RawRun = {
    completed_timestamp?: number;
    duration?: number;
    keystone_level?: number;
    dungeon?: { id?: number; name?: string };
    is_completed_within_time?: boolean;
    mythic_rating?: { rating?: number };
  };
  type Resp = { current_period?: { best_runs?: RawRun[] } };
  const lc = characterName.toLowerCase();
  const data = (await bnetFetch(
    `/profile/wow/character/${realmSlug}/${lc}/mythic-keystone-profile`,
    { skipNextCache: true },
  )) as Resp | null;
  if (!data) return null;
  const raw = data.current_period?.best_runs;
  if (!raw?.length) return [];

  const out: BnetKeystoneRun[] = [];
  for (const r of raw) {
    const ts = r.completed_timestamp;
    const level = r.keystone_level;
    const dungeonId = r.dungeon?.id;
    const dungeon = r.dungeon?.name;
    if (!ts || !level || !dungeonId || !dungeon) continue;
    const durationMs = r.duration ?? 0;
    let upgrades = 0;
    if (r.is_completed_within_time) {
      const thresholds = await getDungeonUpgradeThresholds(dungeonId);
      for (const t of thresholds) {
        if (durationMs > 0 && durationMs <= t.qualifying_duration) {
          upgrades = Math.max(upgrades, t.upgrade_level);
        }
      }
      // In-time but thresholds unavailable → at least one chest.
      if (upgrades === 0) upgrades = 1;
    }
    out.push({
      dungeon,
      dungeonId,
      level,
      completedAt: new Date(ts).toISOString(),
      completedAtMs: ts,
      clearTimeMs: durationMs,
      upgrades,
      score: r.mythic_rating?.rating ?? 0,
    });
  }
  return out;
}
