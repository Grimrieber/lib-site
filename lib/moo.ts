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
import type { Redis } from "@upstash/redis";

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
export async function getRandomCowUrl(
  recentImages: string[] = [],
): Promise<string> {
  const recent = new Set(recentImages);
  try {
    const files = await commonsCowFiles(pick(MOO_COW_CATEGORIES));
    const good = files.filter((f) => !COW_BLOCK.test(f.title));
    // Prefer a cow we haven't posted recently; only fall back to the full set
    // if every survivor in this category is a recent repeat.
    const fresh = good.filter((f) => !recent.has(f.thumb));
    const pool = fresh.length ? fresh : good;
    if (pool.length) return pick(pool).thumb;
  } catch {
    /* fall through to fallback */
  }
  const freshFallback = MOO_COWS.filter((u) => !recent.has(u));
  return pick(freshFallback.length ? freshFallback : MOO_COWS);
}

// ── Non-repeating cow rotation ───────────────────────────────────────────────
// A persisted, ordered playlist that we walk one cow at a time: every picture
// is shown once before any repeats, then the SAME order replays. Dead images
// are dropped from the list the moment they fail to load (Discord embeds a
// broken URL silently — it returns 204 regardless — so we must verify the image
// ourselves before posting). The result: there is always a working cow, and no
// repeat until the whole pool has cycled.
//
// State (Upstash): `lib:moo:playlist` = the ordered URL list for this cycle,
// `lib:moo:cursor` = the next index to serve. Single-writer: only one post
// happens per window (the route's window marker), so plain get/set is safe.
const PLAYLIST_KEY = "lib:moo:playlist";
const CURSOR_KEY = "lib:moo:cursor";
const PLAYLIST_TTL = 60 * 24 * 60 * 60; // 60d; rewritten on every post
// Rebuild the playlist once it's been whittled below this (mass link rot / a
// stale tiny list). The curated MOO_COWS are always folded in, so it never
// drops to zero in practice.
const MIN_PLAYLIST = 8;
// Per-post ceiling on liveness checks, so a Commons-wide outage can't make one
// post fan out into hundreds of HEAD requests. Dead URLs found within this
// budget are still removed; the rest get cleaned on later posts.
const MAX_VALIDATIONS = 6;
const VALIDATE_TIMEOUT_MS = 5000;

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** True only if the URL actually serves an image right now. */
async function imageLoads(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const opts = {
      cache: "no-store" as const,
      signal: ctrl.signal,
      headers: { "User-Agent": "lib-site-moo/1.0" },
    };
    let res = await fetch(url, { method: "HEAD", ...opts });
    // Some hosts reject HEAD; confirm with a 1-byte ranged GET instead.
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        ...opts,
        headers: { ...opts.headers, Range: "bytes=0-0" },
      });
    }
    const ct = res.headers.get("content-type") ?? "";
    return res.ok && /^image\//i.test(ct);
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Pull the full set of wholesome cow URLs across every breed category. */
async function buildCowPlaylist(): Promise<string[]> {
  const urls = new Set<string>();
  const cats = [...new Set(MOO_COW_CATEGORIES)];
  const batches = await Promise.all(
    cats.map((c) => commonsCowFiles(c).catch(() => [])),
  );
  for (const files of batches) {
    for (const f of files) if (!COW_BLOCK.test(f.title)) urls.add(f.thumb);
  }
  // Always fold in the hand-verified fallback cows so the cycle is never empty.
  for (const u of MOO_COWS) urls.add(u);
  // Shuffle once: the cycle order is fixed thereafter (and replays on wrap),
  // but it shouldn't be grouped by category/filename.
  return shuffleInPlace([...urls]);
}

/**
 * Next cow in the rotation — guaranteed to load. Walks the persisted playlist
 * from the cursor, validating each; a dead URL is spliced out (so the next one
 * shifts into its slot and is tried immediately) and never seen again. Wraps to
 * the start when the list is exhausted, replaying the same order. Rebuilds the
 * list when it's missing or has been whittled too small. Always returns a URL.
 */
export async function getNextCowUrl(redis: Redis): Promise<string> {
  let playlist = (await redis.get<string[]>(PLAYLIST_KEY)) ?? [];
  let cursor = (await redis.get<number>(CURSOR_KEY)) ?? 0;

  if (playlist.length < MIN_PLAYLIST) {
    const built = await buildCowPlaylist();
    if (built.length) {
      playlist = built;
      cursor = 0;
    }
  }
  if (!playlist.length) return pick(MOO_COWS); // last-ditch, build totally failed

  let dropped = false;
  for (let checks = 0; checks < MAX_VALIDATIONS && playlist.length; checks++) {
    if (cursor >= playlist.length) cursor = 0; // wrap → same order again
    const candidate = playlist[cursor];
    if (await imageLoads(candidate)) {
      const next = cursor + 1 >= playlist.length ? 0 : cursor + 1;
      await redis.set(PLAYLIST_KEY, playlist, { ex: PLAYLIST_TTL });
      await redis.set(CURSOR_KEY, next, { ex: PLAYLIST_TTL });
      return candidate;
    }
    // Dead: remove it; the next item shifts into `cursor`, so don't advance.
    playlist.splice(cursor, 1);
    dropped = true;
  }

  // Budget exhausted without a live cow (e.g. Commons unreachable). Persist any
  // removals, then guarantee a pic with a curated fallback.
  if (dropped && playlist.length) {
    await redis.set(PLAYLIST_KEY, playlist, { ex: PLAYLIST_TTL });
    await redis.set(CURSOR_KEY, cursor >= playlist.length ? 0 : cursor, {
      ex: PLAYLIST_TTL,
    });
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

export type MooPost = {
  imageUrl: string | null;
  text: string;
  key: string;
  /** "cow" = a rotation pic (deduped); "render" = his live portrait, which is
   *  intentionally recurring (~20%) and therefore exempt from image dedup. */
  kind: "cow" | "render";
};

// A caption candidate plus the key the deduper compares on. For most sources
// the key IS the text (an exact repeat is the only collision worth avoiding);
// activity lines carry a per-run key so the two phrasings of one run collide.
type Candidate = { text: string; key: string };
const keyed = (text: string): Candidate => ({ text, key: text });

// Roll the weighted source list once and produce a candidate.
function rollCandidate(
  sources: { weight: number; gen: () => Candidate }[],
): Candidate {
  const total = sources.reduce((s, x) => s + x.weight, 0);
  let roll = Math.random() * total;
  const chosen =
    sources.find((s) => (roll -= s.weight) < 0 && s.weight > 0) ?? sources[0];
  return chosen.gen();
}

/**
 * Assemble one ready-to-post moo: an image (mostly a cow, sometimes his live
 * render) paired with a fitting caption (render caption for the render; for
 * cows, mostly normal lines, occasionally a live-stat line, rarely a healer
 * line). Mentions become real pings only if the Discord ids are configured.
 *
 * `recentKeys` are the caption dedup keys of the last few posts (passed in by
 * the route from Upstash); the caption pick re-rolls to avoid repeating a line
 * — or the same M+ run dressed two ways. The cow IMAGE is handled separately by
 * the non-repeating rotation (getNextCowUrl) when `redis` is supplied; without
 * a store it degrades to the stateless random picker. The returned `key` is
 * what the caller stores as the newest recent caption key.
 */
export async function buildMooPost(
  recentKeys: string[] = [],
  redis: Redis | null = null,
): Promise<MooPost> {
  const mentions = mentionsFromEnv();
  const recent = new Set(recentKeys);

  if (Math.random() < RENDER_CHANCE && RENDER_CAPTIONS.length) {
    const avail = RENDER_CAPTIONS.filter((t) => !recent.has(t));
    const text = pick(avail.length ? avail : RENDER_CAPTIONS);
    return {
      imageUrl: await getBoobRender(),
      text: renderCaption(text, mentions),
      key: text,
      kind: "render",
    };
  }

  const imageUrl = redis ? await getNextCowUrl(redis) : await getRandomCowUrl();
  const stats = await getBoobStats();

  // Build a weighted source list so material never runs dry: live activity and
  // dynamic-stat lines when available, the infinite combinatorial generator,
  // the curated static greatest-hits, and a rare healer/Kujatas line.
  const dynamic = usableDynamicCaptions(stats);
  const activity = activityCaptions(stats);
  const sources: { weight: number; gen: () => Candidate }[] = [
    { weight: 35, gen: () => keyed(generateCaption()) },
    { weight: 25, gen: () => keyed(pick(COW_NORMAL)) },
    { weight: activity.length ? 20 : 0, gen: () => pick(activity) },
    { weight: dynamic.length ? 15 : 0, gen: () => keyed(pick(dynamic)) },
    { weight: COW_HEALER.length ? 5 : 0, gen: () => keyed(pick(COW_HEALER)) },
  ];

  // Re-roll a handful of times to dodge a recently-used key; keep the last roll
  // as a fallback so we always post something even if everything collides.
  let chosen = rollCandidate(sources);
  for (let i = 0; i < 12 && recent.has(chosen.key); i++) {
    chosen = rollCandidate(sources);
  }
  return {
    imageUrl,
    text: renderCaption(chosen.text, mentions),
    key: chosen.key,
    kind: "cow",
  };
}
