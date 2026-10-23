/**
 * ZamboniBoob vs Churd — the achievement-points rivalry for #only-moo.
 *
 * Both are on Eonar, both sit within a few hundred points of each other, and
 * they play completely differently: Boob wanders (Exploration, Skyriding,
 * Quests), Churd groups up (Dungeons & Raids, Delves, World Events). That
 * contrast, not the raw total, is what makes this worth posting.
 *
 * Everything here is PURE. The BNet fetches live in moo-events.ts; this module
 * only shapes two already-fetched achievement payloads, so the harness can hold
 * it to real edge cases without network.
 *
 * TWO DATA TRAPS, both found by checking the live payloads rather than assuming:
 *
 *  1. `category_progress` can contain SEVERAL entries sharing a display name
 *     with different ids. Churd carries "Quests" twice — id 96 with 3,640
 *     points and id 15447 with 0. Keying a map by NAME let the zero clobber the
 *     real value and reported him as having 0 quest points against Boob's
 *     4,115, which would have been a confidently wrong post. Key by ID, and sum
 *     when ids repeat.
 *
 *  2. Category points DOUBLE-COUNT, because categories nest (a parent includes
 *     its children). Boob's categories sum to ~81,190 while his actual total is
 *     42,535. So category figures are only ever comparable BETWEEN the two
 *     characters within the same category — never summed, never presented as a
 *     total. `pointsGap` comes from `total_points` alone.
 */

/** Minimal shape of the bits of BNet's achievements payload we compare. */
export type RivalAchievements = {
  totalPoints: number;
  totalEarned: number;
  /** Dated achievements only — an undated one has no "when", so it can't be
   *  used for "what did he just get that you didn't". */
  earned: { id: number; name: string; completedAt: number }[];
  categories: { id: number; name: string; points: number; quantity: number }[];
};

export type CategoryDelta = {
  name: string;
  /** Points for the character we're writing about (Boob). */
  minePoints: number;
  /** Points for the rival (Churd). */
  theirPoints: number;
  /** mine - theirs. Positive = Boob ahead. */
  delta: number;
};

export type Exclusive = { id: number; name: string; completedAt: number };

export type Rivalry = {
  /** theirs - mine. POSITIVE means the rival is ahead, which is the normal
   *  case and reads naturally as "350 points behind". */
  pointsGap: number;
  minePoints: number;
  theirPoints: number;
  mineEarned: number;
  theirEarned: number;
  /** Earned by Boob, not by Churd — newest first. */
  mineOnly: Exclusive[];
  /** Earned by Churd, not by Boob — newest first. */
  theirOnly: Exclusive[];
  /** Categories where Boob leads, biggest lead first. */
  mineLeads: CategoryDelta[];
  /** Categories where Churd leads, biggest lead first. */
  theirLeads: CategoryDelta[];
};

/** Sum category points per ID (never per name — see trap 1). */
function byCategoryId(
  cats: RivalAchievements["categories"],
): Map<number, { name: string; points: number }> {
  const out = new Map<number, { name: string; points: number }>();
  for (const c of cats) {
    const prev = out.get(c.id);
    out.set(c.id, {
      name: c.name,
      points: (prev?.points ?? 0) + (c.points ?? 0),
    });
  }
  return out;
}

/**
 * Compare Boob ("mine") against Churd ("theirs").
 *
 * `minCategoryDelta` drops near-ties: a 5-point edge is noise, not a rivalry,
 * and listing it makes the post look desperate.
 */
export function compareRivals(
  mine: RivalAchievements,
  theirs: RivalAchievements,
  opts: { minCategoryDelta?: number; maxExclusives?: number } = {},
): Rivalry {
  const minDelta = opts.minCategoryDelta ?? 50;
  const maxEx = opts.maxExclusives ?? 8;

  const mineIds = new Set(mine.earned.map((e) => e.id));
  const theirIds = new Set(theirs.earned.map((e) => e.id));

  const newestFirst = (a: Exclusive, b: Exclusive) => b.completedAt - a.completedAt;
  const mineOnly = mine.earned
    .filter((e) => !theirIds.has(e.id))
    .sort(newestFirst)
    .slice(0, maxEx);
  const theirOnly = theirs.earned
    .filter((e) => !mineIds.has(e.id))
    .sort(newestFirst)
    .slice(0, maxEx);

  const mc = byCategoryId(mine.categories);
  const tc = byCategoryId(theirs.categories);
  const deltas: CategoryDelta[] = [];
  for (const id of new Set([...mc.keys(), ...tc.keys()])) {
    const m = mc.get(id);
    const t = tc.get(id);
    const name = m?.name ?? t?.name ?? "";
    // A category only ONE of them has is a real difference (the other has zero
    // progress), so absent counts as 0 rather than being skipped.
    const minePoints = m?.points ?? 0;
    const theirPoints = t?.points ?? 0;
    const delta = minePoints - theirPoints;
    if (Math.abs(delta) < minDelta) continue;
    deltas.push({ name, minePoints, theirPoints, delta });
  }

  return {
    pointsGap: theirs.totalPoints - mine.totalPoints,
    minePoints: mine.totalPoints,
    theirPoints: theirs.totalPoints,
    mineEarned: mine.totalEarned,
    theirEarned: theirs.totalEarned,
    mineOnly,
    theirOnly,
    mineLeads: deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta),
    theirLeads: deltas.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta),
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");


/**
 * COPY LAYER.
 *
 * The first version read like a quarterly report — "Where he wins: Exploration
 * (+855)" — which was accurate and completely unfunny. #only-moo's voice is
 * short, deadpan and affectionate ("We found {boob}'s baby photos. Every single
 * one was a cow."): one joke per line, no labelled lists. So this builds a bit.
 *
 * Variants come from a SEED rather than Math.random, so the post changes week to
 * week without anyone adding lines, and a preview shows exactly what the job
 * would post. Same approach as moo-generate.ts — add one phrase, get new posts.
 */

/** Achievement names can end in their own punctuation ("I Found Pepe!"), and
 *  "*I Found Pepe!*." reads like a typo. */
function sentence(body: string): string {
  // Look PAST the closing markdown, or "*I Found Pepe!*" tests as ending in
  // "*" and gets a period appended anyway.
  const bare = body.trim().replace(/[*_~`]+$/, "");
  return /[.!?]$/.test(bare) ? body : `${body}.`;
}

function pick<T>(bank: readonly T[], seed: number, salt = 0): T {
  const h =
    Math.abs(Math.imul(seed + salt * 2654435761, 2246822519)) % bank.length;
  return bank[h];
}

/**
 * Flavour for the categories Boob leads. He wins everything you get by
 * WANDERING — Exploration, Skyriding, Quests — so the joke is always that his
 * lead is sightseeing rather than playing. The fallback matters: a new patch
 * can add a category name none of these match, and a blank punchline is worse
 * than a generic one.
 */
const MINE_JAB: readonly [RegExp, readonly string[]][] = [
  [/exploration|skyriding|dragon isles|flight/i, [
    "An'she is out there, and the sun does not shine in a dungeon.",
    "he has seen more of Azeroth than Churd. Most of it from the floor.",
    "the Sunwalker is outside. Of course the Sunwalker is outside.",
    "nobody has ever flown that far to accomplish that little.",
  ]],
  [/expansion features|dragonflight|shadowlands|battle for azeroth|legion|warlords|pandaria/i, [
    "he has done the old expansions Churd skipped. Thoroughly. Years late.",
    "he is farming content from expansions Churd has forgotten the name of.",
  ]],
  [/quest|reputation/i, [
    "he has talked to more NPCs than Churd has killed bosses.",
    "reading every quest text finally paid off.",
    "he is dominating the part of the game with no enemies in it.",
  ]],
  [/cook|fish|archaeolog|profession|blacksmith|jewelcraft/i, [
    "he is ahead on chores. Genuinely proud of him.",
    "the man has a trade. Churd has a raid lockout.",
  ]],
  [/darkmoon|pet|pilgrim|winter veil|lunar|holiday|world event|faire/i, [
    "he is winning the holiday content. The holiday content.",
    "unmatched at the parts of the game that are essentially a village fête.",
  ]],
  [/pvp|battleground|arena|rated/i, [
    "he has been farmed in more battlegrounds than Churd has entered.",
  ]],
];
const MINE_FALLBACK: readonly string[] = [
  "we are not sure how, and we are not asking.",
  "a lead nobody requested, defended fiercely.",
];

/** Flavour for where Churd buries him — the grouped-up, show-up-on-time content. */
const THEIRS_JAB: readonly [RegExp, readonly string[]][] = [
  [/dungeon|raid|keystone|mythic/i, [
    "Churd has been inside the raid. {boob} has been in a field, admiring the sun.",
    "Churd kills bosses. {boob} finds frogs.",
    "that entire gap is just Churd turning up on raid night.",
    "a paladin losing to a priest at this. Put the hammer down, {boob}.",
  ]],
  [/delve/i, [
    "a man who likes the dark, in a hole. Checks out, for a shadow priest.",
    "Churd goes underground voluntarily. {boob} needs daylight and a field.",
  ]],
  [/world event|reputation|quest/i, [
    "Churd does the daily content. {boob} does whatever he fancies.",
    "Churd grinds. {boob} wanders.",
  ]],
  [/collection|pet|mount|transmog/i, [
    "Churd collects things. {boob} collects fall damage.",
  ]],
];
const THEIRS_FALLBACK: readonly string[] = [
  "Churd is simply better at this one and we should all sit with that.",
  "no notes. Churd took that category outright.",
];

function flavour(
  name: string,
  banks: readonly [RegExp, readonly string[]][],
  fallback: readonly string[],
  seed: number,
): string {
  for (const [re, lines] of banks) if (re.test(name)) return pick(lines, seed, 7);
  return pick(fallback, seed, 7);
}

/**
 * THE MATCHUP ITSELF — a Tauren Retribution paladin (Horde) against a Human
 * Shadow priest (Alliance), in the same guild.
 *
 * This is the best material in the whole post because the classes map onto the
 * REAL category data: a Sunwalker who worships An'she leads Exploration,
 * Skyriding and Quests (outdoors, daylight), while the void-whispered priest
 * leads Dungeons & Raids and Delves (underground, dark). The joke writes itself
 * and it happens to be true.
 *
 * Hardcoded deliberately, like BOOB and RIVAL in moo-events.ts — this is one
 * specific pairing, not a roster feature.
 */
const MATCHUP: readonly string[] = [
  "A Tauren paladin against a human shadow priest. One worships the sun, the other worships whatever is whispering at him.",
  "Sunwalker versus void-botherer. {boob} found the Light. Churd had it and put it down.",
  "{boob} is a cow who got religion. Churd is a human who gave his up. Somehow Churd is ahead.",
  "{boob} swings a hammer for An'she. Churd whispers at people until they fall over. Both of these count as DPS.",
  "Horde cow, Alliance human, same guild, same scoreboard. The war ended; the bickering did not.",
  "A Retribution paladin being out-pointed by a man whose entire rotation is intrusive thoughts.",
  "One of them is a holy cow. The other is a human who talks to the dark. Neither will let this go.",
];

const OPEN_BEHIND: readonly string[] = [
  "{boob} is **{gap} achievement points** behind Churd. Close enough to smell it.",
  "Scoreboard: Churd **{them}**, {boob} **{me}**. A **{gap}** point gap and zero shame.",
  "**{gap}** points. That is the entire distance between {boob} and beating Churd.",
  "{boob} trails Churd by **{gap}**, a figure he will describe as a rounding error.",
];
const OPEN_AHEAD: readonly string[] = [
  "{boob} is **{gap} points AHEAD** of Churd. Screenshot it. It will not last.",
  "Against all available evidence, {boob} leads Churd by **{gap}**.",
  "{boob} **{me}**, Churd **{them}**. The cow is winning. Everyone remain calm.",
];
const OPEN_LEVEL: readonly string[] = [
  "{boob} and Churd are **dead level** on **{me}**. Someone go do a dungeon.",
  "Perfectly tied at **{me}** apiece. This cannot be allowed to stand.",
];

const CLOSERS: readonly string[] = [
  "Fix it, {boob}.",
  "The herd is watching, {boob}.",
  "Moo responsibly.",
  "We believe in you. Mildly.",
  "{boob}, this is your villain origin story.",
];

/** The class/race matchup jab — see MATCHUP. */
export function rivalryMatchupLine(seed = 0): string {
  return pick(MATCHUP, seed, 13);
}

/** Headline. Reads correctly whichever way the gap points — they are a few
 *  hundred apart, so it WILL flip, and copy that only works while he loses is
 *  copy that breaks the week he wins. */
export function rivalryHeadline(r: Rivalry, seed = 0): string {
  const bank =
    r.pointsGap === 0 ? OPEN_LEVEL : r.pointsGap > 0 ? OPEN_BEHIND : OPEN_AHEAD;
  return pick(bank, seed)
    .replace(/\{gap\}/g, fmt(Math.abs(r.pointsGap)))
    .replace(/\{me\}/g, fmt(r.minePoints))
    .replace(/\{them\}/g, fmt(r.theirPoints));
}

/** The contrast, as sentences with punchlines. This is the part that lands:
 *  the categories ARE the two personalities. */
export function rivalryStyleLines(r: Rivalry, seed = 0): string[] {
  const out: string[] = [];
  // Rotate WHICH category gets talked about, not just how. Picking [0] every
  // week meant the same two categories forever and only the phrasing changed -
  // which is the staleness this engine exists to avoid. Top few only, so it
  // never drops to a 60-point rounding error for variety's sake.
  const mine = r.mineLeads.length ? pick(r.mineLeads.slice(0, 4), seed, 17) : undefined;
  const theirs = r.theirLeads.length ? pick(r.theirLeads.slice(0, 4), seed, 19) : undefined;
  if (mine) {
    out.push(
      `Up **${fmt(mine.delta)}** in **${mine.name}** — ${flavour(mine.name, MINE_JAB, MINE_FALLBACK, seed)}`,
    );
  }
  if (theirs) {
    out.push(
      `Down **${fmt(-theirs.delta)}** in **${theirs.name}** — ${flavour(theirs.name, THEIRS_JAB, THEIRS_FALLBACK, seed)}`,
    );
  }
  return out;
}

/** One named callout each way, with the joke in the framing. A bare list of
 *  twelve achievement names is data, not comedy. */
export function rivalryExclusiveLines(r: Rivalry, seed = 0): string[] {
  const out: string[] = [];
  // Same reasoning as the categories: rotate the achievement, not just the
  // framing, or it is "I Found Pepe!" every week until the heat death.
  const mine = r.mineOnly.length ? pick(r.mineOnly.slice(0, 5), seed, 23) : undefined;
  const theirs = r.theirOnly.length ? pick(r.theirOnly.slice(0, 5), seed, 29) : undefined;
  if (mine) {
    out.push(
      pick([
        sentence(`In fairness, Churd does not have *${mine.name}* — and has never needed *${mine.name}*`),
        sentence(`{boob} holds *${mine.name}* — Churd does not. Make of that what you will`),
        sentence(`Exclusive to {boob}: *${mine.name}* — unanswerable, frankly`),
      ], seed, 3),
    );
  }
  if (theirs) {
    out.push(
      pick([
        sentence(`Churd meanwhile picked up *${theirs.name}*, which {boob} has not`),
        sentence(`Churd has *${theirs.name}* — {boob} has vibes`),
        sentence(`Still absent from the cow’s collection: *${theirs.name}*`),
      ], seed, 5),
    );
  }
  return out;
}

/**
 * The whole post. Empty when either side reads zero — that means a BNet fetch
 * failed, and "42,535 points ahead" is a far worse post than no post.
 */
export function buildRivalryPost(r: Rivalry, seed = 0): string[] {
  if (r.minePoints <= 0 || r.theirPoints <= 0) return [];
  return [
    rivalryHeadline(r, seed),
    rivalryMatchupLine(seed),
    ...rivalryStyleLines(r, seed),
    ...rivalryExclusiveLines(r, seed),
    pick(CLOSERS, seed, 11),
  ];
}

/**
 * Should the rivalry post fire for this window?
 *
 * Extracted from the route on purpose. Twice this project has shipped a gate
 * buried inside an async function — the season-accolade scan and the local
 * refresh's stderr trap — and in both cases the bug was invisible because
 * nothing could exercise the decision without network and a webhook. This is
 * the whole decision, as data in and a boolean out.
 *
 * `force` (?force=1) bypasses the hour and the dedup for a deliberate one-off
 * test, exactly as it does for the cow post.
 */
export function rivalryDue(opts: {
  /** UTC hour of the window being served. */
  windowHour: number;
  /** The hour the rivalry is allowed to post in — evening only, so daily. */
  rivalryHour: number;
  /** ISO stamp of the window this post last served, if any. */
  lastStamp: string | null;
  /** ISO stamp of the window being served now. */
  dueStamp: string;
  force?: boolean;
}): boolean {
  if (opts.force) return true;
  if (opts.windowHour !== opts.rivalryHour) return false;
  // Equality, not >=: the cow's own marker handles ordering, and this only has
  // to stop the SAME window posting twice when a runner retries it.
  if (opts.lastStamp && opts.lastStamp === opts.dueStamp) return false;
  return true;
}

/** Day-stable seed: same all through a window, different tomorrow. Keeps the
 *  preview for a given day equal to what the channel actually received. */
export function rivalrySeedForWindow(dueWindow: Date): number {
  return Math.floor(dueWindow.getTime() / 86_400_000);
}
