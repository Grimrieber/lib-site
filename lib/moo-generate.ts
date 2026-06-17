import type { MooStats } from "@/lib/moo-captions";

/**
 * Self-replenishing caption material so the channel never runs dry without
 * someone hand-adding lines. Two engines here, on top of the curated static
 * pool in data/moo-captions.json:
 *
 *   1. generateCaption() — combinatorial. A small bank of interchangeable
 *      fragments (cow nouns x his ribbed habits x stats x cow-virtues) run
 *      through grammar-safe patterns. ~8 patterns x the fragment banks below
 *      = thousands of distinct, readable lines. Add one fragment, get dozens
 *      more combinations for free.
 *
 *   2. activityCaptions() — pulls his ACTUAL recent M+ runs (from Raider.IO via
 *      getBoobStats) and writes lines about what he literally just did. Fresh
 *      every week because it tracks real activity, not a fixed list.
 *
 * All output keeps the {boob}/{kuja} tokens so renderCaption() handles mentions.
 */

const COW = [
  "this cow",
  "this heifer",
  "this coo",
  "that magnificent beast",
  "the prize bull",
  "today's cow",
  "this fine animal",
  "this hairy lad",
  "this contented cow",
  "the herd's finest",
  "this absolute unit",
];

// Past tense — for "today {boob} ___" lines.
const FAIL_PAST = [
  "stood in the fire",
  "pulled before the tank",
  "ate every swirly",
  "found the one void zone",
  "facetanked the boss",
  "ignored the timer",
  "parked in Sanguine",
  "missed the interrupt",
  "stood in the bad",
  "kissed the frontal",
  "bubble-hearthed at 90%",
];

const STAT = [
  "uptime",
  "positioning",
  "survivability",
  "mechanics",
  "defensive cooldowns",
  "situational awareness",
  "self-preservation",
  "footwork",
];

const VIRTUE = [
  "never stands in fire",
  "dodges every puddle",
  "has flawless uptime",
  "respects the pull timer",
  "knows exactly what grass is",
  "has never once died to Sanguine",
  "keeps its hooves out of the bad",
  "has perfect parses",
];

const LOVE = [
  "We love him.",
  "What a guy.",
  "Beloved regardless.",
  "Never change, {boob}.",
  "Icon.",
  "King.",
  "Our boy.",
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

type Frag = {
  cow: string;
  cow2: string;
  fail: string;
  stat: string;
  virtue: string;
  love: string;
};

const PATTERNS: ((f: Frag) => string)[] = [
  (f) => `${cap(f.cow)} has better ${f.stat} than {boob}. And it's a cow.`,
  (f) => `{boob} ${f.fail}. ${cap(f.cow)} would never. ${f.love}`,
  (f) => `${cap(f.cow)} ${f.virtue}. Take notes, {boob}.`,
  (f) => `Daily moo. ${cap(f.cow)} says hi to its cousin, {boob}.`,
  (f) => `One of these ${f.virtue}. The other is {boob}.`,
  (f) => `{boob} ${f.fail} again. ${cap(f.cow)} watched in disbelief.`,
  (f) => `${cap(f.cow)}: elite ${f.stat}. {boob}: ${f.love}`,
  (f) =>
    `Gave ${f.cow} and {boob} the same ${f.stat} test. ${cap(f.cow2)} won.`,
  (f) => `${cap(f.cow)} ${f.virtue} and asks for nothing. Unlike {boob}.`,
];

/** One freshly composed caption (with {boob} tokens). Effectively unbounded. */
export function generateCaption(): string {
  const f: Frag = {
    cow: pick(COW),
    cow2: pick(COW),
    fail: pick(FAIL_PAST),
    stat: pick(STAT),
    virtue: pick(VIRTUE),
    love: pick(LOVE),
  };
  return pick(PATTERNS)(f);
}

/**
 * Captions written from his ACTUAL recent M+ runs — fresh material that tracks
 * what he really did. Empty when no run data is available (job falls back to
 * the other engines).
 */
export function activityCaptions(stats: MooStats): string[] {
  const out: string[] = [];
  for (const r of stats.recentRuns ?? []) {
    if (r.timed) {
      out.push(
        `{boob} timed ${r.dungeon} +${r.level} this week. Respectable, for a cow.`,
      );
      out.push(
        `Fresh off a +${r.level} ${r.dungeon}, {boob} returns to the pasture a hero.`,
      );
    } else {
      out.push(
        `{boob} bricked— sorry, "depleted" ${r.dungeon} +${r.level}. The herd sends support.`,
      );
    }
  }
  return out;
}
