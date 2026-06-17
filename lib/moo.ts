import { getCharacterRenderUrl } from "@/lib/battlenet";
import { MOO_COWS, MOO_BOOB_RENDER, MOO_COW_CATEGORIES } from "@/lib/moo-cows";
import {
  MOO_CAPTION_DB,
  renderCaption,
  usableDynamicCaptions,
  type MooStats,
  type MooMentions,
} from "@/lib/moo-captions";
import { generateCaption, activityCaptions } from "@/lib/moo-generate";

/**
 * Self-managing post builder for the #only-moo channel. Everything it needs is
 * fetched LIVE or read from the committed data, so the channel never needs
 * hand-tending:
 *   - His character render is pulled fresh from BNet, so it tracks his transmog
 *     (the yellow pajamas today, whatever he wears next month).
 *   - His M+ score / ilvl / raid progress are pulled fresh from Raider.IO, so
 *     the stat captions are always current.
 *   - Cows + captions are the curated, quality-checked static pools (cows are
 *     deliberately NOT auto-scraped — that's what surfaced junk before).
 * The twice-a-day job just calls buildMooPost() and posts the result.
 */

// ZamboniBoob = MeatSupreme, Tauren Ret Paladin on Eonar.
const BOOB = { realm: "eonar", name: "Meatsupreme" } as const;
const REGION = process.env.BNET_REGION ?? "us";

// Roughly 1 in 5 posts is "the man himself" (his render) instead of a cow.
const RENDER_CHANCE = 0.2;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Filenames that suggest something other than a nice live cow — skull/meat/
// anatomy diagrams, art, maps, signage. Belt-and-suspenders on top of the
// breed-category restriction so the automated pull stays wholesome.
const COW_BLOCK =
  /skull|skelet|carcass|slaughter|butcher|\bmeat\b|\bbeef\b|anatom|diagram|dissect|\bdead\b|taxiderm|\bhide\b|leather|\bmap\b|\bchart\b|logo|coat[_ ]of[_ ]arms|\bsign\b|illustrat|engrav|drawing|painting|\bart\b/i;

/** Fetch up to 200 image files from a Commons category, with thumbnail URLs. */
async function commonsCowFiles(
  category: string,
): Promise<{ title: string; thumb: string }[]> {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query` +
    `&generator=categorymembers&gcmtitle=${encodeURIComponent(category)}` +
    `&gcmtype=file&gcmlimit=200&prop=imageinfo&iiprop=url|mime&iiurlwidth=960` +
    `&format=json&origin=*`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  const d = (await fetch(url, {
    cache: "no-store",
    signal: ctrl.signal,
    headers: { "User-Agent": "lib-site-moo/1.0" },
  }).then((r) => r.json())) as {
    query?: {
      pages?: Record<
        string,
        { title?: string; imageinfo?: { thumburl?: string; mime?: string }[] }
      >;
    };
  };
  clearTimeout(t);
  return Object.values(d.query?.pages ?? {})
    .map((p) => {
      const ii = p.imageinfo?.[0];
      return p.title && ii?.thumburl && /jpe?g|png/i.test(ii.mime ?? "")
        ? { title: p.title, thumb: ii.thumburl }
        : null;
    })
    .filter((x): x is { title: string; thumb: string } => x !== null);
}

/**
 * A random, wholesome cow from Commons breed categories — effectively unlimited
 * variety, no manual curation. Picks a random category, pulls its files, drops
 * anything matching COW_BLOCK, returns a random survivor. Falls back to the
 * curated MOO_COWS list if Commons is unreachable.
 */
export async function getRandomCowUrl(): Promise<string> {
  try {
    const files = await commonsCowFiles(pick(MOO_COW_CATEGORIES));
    const good = files.filter((f) => !COW_BLOCK.test(f.title));
    if (good.length) return pick(good).thumb;
  } catch {
    /* fall through to fallback */
  }
  return pick(MOO_COWS);
}

/** His current render (live transmog), falling back to the baked-in URL. */
export async function getBoobRender(): Promise<string> {
  try {
    const live = await getCharacterRenderUrl(BOOB.realm, BOOB.name);
    if (live) return live;
  } catch {
    /* fall through */
  }
  return MOO_BOOB_RENDER;
}

/** His live Raider.IO stats for the dynamic captions. Best-effort. */
export async function getBoobStats(): Promise<MooStats> {
  try {
    const url =
      `https://raider.io/api/v1/characters/profile?region=${REGION}` +
      `&realm=${BOOB.realm}&name=${BOOB.name}` +
      `&fields=mythic_plus_scores_by_season:current,gear,raid_progression,mythic_plus_best_runs,mythic_plus_recent_runs`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const d = (await fetch(url, {
      cache: "no-store",
      signal: ctrl.signal,
      headers: { "User-Agent": "lib-site-moo/1.0" },
    }).then((r) => r.json())) as {
      mythic_plus_scores_by_season?: { scores?: { all?: number } }[];
      gear?: { item_level_equipped?: number };
      raid_progression?: Record<string, { summary?: string }>;
      mythic_plus_best_runs?: { mythic_level?: number }[];
      mythic_plus_recent_runs?: {
        dungeon?: string;
        mythic_level?: number;
        num_keystone_upgrades?: number;
      }[];
    };
    clearTimeout(t);
    const score = d.mythic_plus_scores_by_season?.[0]?.scores?.all;
    const ilvl = d.gear?.item_level_equipped;
    // Newest tier with any Mythic progress, e.g. "3/9 M".
    const raid = Object.values(d.raid_progression ?? {})
      .map((p) => p.summary)
      .filter((s): s is string => !!s && / M$/.test(s))
      .pop();
    const keylvl = d.mythic_plus_best_runs?.[0]?.mythic_level;
    const recentRuns = (d.mythic_plus_recent_runs ?? [])
      .slice(0, 6)
      .filter((r) => r.dungeon && r.mythic_level != null)
      .map((r) => ({
        dungeon: r.dungeon as string,
        level: r.mythic_level as number,
        timed: (r.num_keystone_upgrades ?? 0) > 0,
      }));
    return {
      score: score != null ? Math.round(score) : undefined,
      ilvl: ilvl ?? undefined,
      raid: raid ?? undefined,
      keylvl: keylvl ?? undefined,
      recentRuns,
    };
  } catch {
    return {};
  }
}

function mentionsFromEnv(): MooMentions {
  return {
    boob: process.env.MOO_BOOB_DISCORD_ID,
    kuja: process.env.MOO_KUJA_DISCORD_ID,
  };
}

const RENDER_CAPTIONS = MOO_CAPTION_DB.filter((c) =>
  c.tags?.includes("render"),
).map((c) => c.text);
const COW_CAPTIONS = MOO_CAPTION_DB.filter((c) => !c.tags?.includes("render"));
const COW_HEALER = COW_CAPTIONS.filter((c) => c.tags?.includes("healer")).map(
  (c) => c.text,
);
const COW_NORMAL = COW_CAPTIONS.filter(
  (c) => !c.tags?.includes("healer"),
).map((c) => c.text);

export type MooPost = { imageUrl: string | null; text: string };

/**
 * Assemble one ready-to-post moo: an image (mostly a cow, sometimes his live
 * render) paired with a fitting caption (render caption for the render; for
 * cows, mostly normal lines, occasionally a live-stat line, rarely a healer
 * line). Mentions become real pings only if the Discord ids are configured.
 */
export async function buildMooPost(): Promise<MooPost> {
  const mentions = mentionsFromEnv();

  if (Math.random() < RENDER_CHANCE && RENDER_CAPTIONS.length) {
    return {
      imageUrl: await getBoobRender(),
      text: renderCaption(pick(RENDER_CAPTIONS), mentions),
    };
  }

  const imageUrl = await getRandomCowUrl();
  const stats = await getBoobStats();

  // Build a weighted source list so material never runs dry: live activity and
  // dynamic-stat lines when available, the infinite combinatorial generator,
  // the curated static greatest-hits, and a rare healer/Kujatas line.
  const dynamic = usableDynamicCaptions(stats);
  const activity = activityCaptions(stats);
  const sources: { weight: number; gen: () => string }[] = [
    { weight: 35, gen: () => generateCaption() },
    { weight: 25, gen: () => pick(COW_NORMAL) },
    { weight: activity.length ? 20 : 0, gen: () => pick(activity) },
    { weight: dynamic.length ? 15 : 0, gen: () => pick(dynamic) },
    { weight: COW_HEALER.length ? 5 : 0, gen: () => pick(COW_HEALER) },
  ];
  const total = sources.reduce((s, x) => s + x.weight, 0);
  let roll = Math.random() * total;
  const chosen =
    sources.find((s) => (roll -= s.weight) < 0 && s.weight > 0) ?? sources[0];
  return { imageUrl, text: renderCaption(chosen.gen(), mentions) };
}
