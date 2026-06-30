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

// His render ("the man himself" — his LIVE portrait) posts on a FIXED cadence:
// exactly every 14th post (14, 28, 42, …). At twice-daily that's once a week,
// dead regular, never clustered. It's a single recurring image and the user is
// fine with that on this schedule.
const RENDER_EVERY = 14;
// Total moos posted so far (cows + renders). The route increments it on each
// successful post; the render lands whenever the NEXT post number is a multiple
// of RENDER_EVERY. Exported so the route owns the counter.
export const POST_COUNT_KEY = "lib:moo:postcount";

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
        completed_at?: string;
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
    // ONLY genuinely-recent runs (last 7 days). RIO's recent_runs list keeps a
    // character's last ~10 runs regardless of age, so without this filter a key
    // he ran weeks ago gets captioned "Fresh off… this week" (it lied about a
    // +11 Nexus-Point Xenas he hadn't touched in ages). No recent run -> empty
    // -> no key-moo fires -> the post falls back to the combinatorial generator.
    const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentRuns = (d.mythic_plus_recent_runs ?? [])
      .filter(
        (r) =>
          r.dungeon &&
          r.mythic_level != null &&
          r.completed_at &&
          new Date(r.completed_at).getTime() >= recentCutoff,
      )
      .slice(0, 6)
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
// Pick a COW caption: weighted sources (infinite generator + curated static +
// live activity/stat lines + rare healer) with a dedup re-roll against `recent`.
// Extracted so buildMooPost AND the preview simulator use the EXACT same picker.
function pickCowCaption(recent: Set<string>, stats: MooStats): Candidate {
  const dynamic = usableDynamicCaptions(stats);
  const activity = activityCaptions(stats);
  // Near-zero repeats: the combinatorial generator (~1.1M lines, effectively
  // never repeats) carries the overwhelming majority. The small FINITE pools —
  // curated one-liners, the few live-stat templates, the rare healer line — are
  // heavily de-weighted so a familiar line basically stops coming back. Activity
  // lines are the exception: they're genuinely fresh (his real last-7-day runs,
  // 7-day-filtered), so they keep a real share whenever he has recent runs.
  const sources: { weight: number; gen: () => Candidate }[] = [
    { weight: 80, gen: () => keyed(generateCaption()) },
    { weight: activity.length ? 14 : 0, gen: () => pick(activity) },
    { weight: 6, gen: () => keyed(pick(COW_NORMAL)) },
    { weight: dynamic.length ? 3 : 0, gen: () => keyed(pick(dynamic)) },
    { weight: COW_HEALER.length ? 1 : 0, gen: () => keyed(pick(COW_HEALER)) },
  ];
  let chosen = rollCandidate(sources);
  for (let i = 0; i < 12 && recent.has(chosen.key); i++) {
    chosen = rollCandidate(sources);
  }
  return chosen;
}

function pickRenderCaption(recent: Set<string>): string {
  const avail = RENDER_CAPTIONS.filter((t) => !recent.has(t));
  return pick(avail.length ? avail : RENDER_CAPTIONS);
}

export async function buildMooPost(
  recentKeys: string[] = [],
  redis: Redis | null = null,
  forceRender = false,
): Promise<MooPost> {
  const mentions = mentionsFromEnv();
  const recent = new Set(recentKeys);

  // The route passes forceRender when this post lands on the every-14th cadence.
  if (forceRender && RENDER_CAPTIONS.length) {
    const text = pickRenderCaption(recent);
    return {
      imageUrl: await getBoobRender(),
      text: renderCaption(text, mentions),
      key: text,
      kind: "render",
    };
  }

  const imageUrl = redis ? await getNextCowUrl(redis) : await getRandomCowUrl();
  const stats = await getBoobStats();
  const chosen = pickCowCaption(recent, stats);
  return {
    imageUrl,
    text: renderCaption(chosen.text, mentions),
    key: chosen.key,
    kind: "cow",
  };
}

/**
 * Simulate the next `count` moos exactly as buildMooPost + the /api/moo route
 * would produce them — same render-vs-cow roll, same image-rotation walk, same
 * caption picker + dedup — but ENTIRELY IN MEMORY. It reads the live rotation +
 * dedup state read-only (so the preview starts from "now") and never writes, so
 * it can't disturb the real channel. For the dev-only preview page.
 */
export async function simulateMoos(
  redis: Redis | null,
  count: number,
): Promise<MooPost[]> {
  const mentions = mentionsFromEnv();
  const [stats, renderUrl] = await Promise.all([getBoobStats(), getBoobRender()]);
  let playlist: string[] = [];
  let cursor = 0;
  let recentKeys: string[] = [];
  let recentImages: string[] = [];
  if (redis) {
    playlist = (await redis.get<string[]>(PLAYLIST_KEY)) ?? [];
    cursor = (await redis.get<number>(CURSOR_KEY)) ?? 0;
    recentKeys = (await redis.get<string[]>("lib:moo:recentkeys")) ?? [];
    recentImages = (await redis.get<string[]>("lib:moo:recentimages")) ?? [];
  }
  if (!playlist.length) playlist = [...MOO_COWS];
  const recent = new Set(recentKeys);
  const seenImages = [...recentImages];
  const out: MooPost[] = [];
  for (let i = 0; i < count; i++) {
    // Render on the fixed every-14th cadence (posts 14, 28, 42, …), matching the
    // live route's post-counter rule.
    if ((i + 1) % RENDER_EVERY === 0 && RENDER_CAPTIONS.length) {
      const text = pickRenderCaption(recent);
      recent.add(text);
      out.push({
        imageUrl: renderUrl,
        text: renderCaption(text, mentions),
        key: text,
        kind: "render",
      });
      continue;
    }
    // Walk the playlist from the cursor, skipping recently-used images (mirrors
    // getNextCowUrl + the route's tripwire); no liveness checks in the preview.
    if (cursor >= playlist.length) cursor = 0;
    let img = playlist[cursor];
    cursor = cursor + 1 >= playlist.length ? 0 : cursor + 1;
    for (let t = 0; t < 5 && seenImages.includes(img); t++) {
      img = playlist[cursor];
      cursor = cursor + 1 >= playlist.length ? 0 : cursor + 1;
    }
    const chosen = pickCowCaption(recent, stats);
    recent.add(chosen.key);
    seenImages.unshift(img);
    if (seenImages.length > 40) seenImages.pop();
    out.push({
      imageUrl: img,
      text: renderCaption(chosen.text, mentions),
      key: chosen.key,
      kind: "cow",
    });
  }
  return out;
}
