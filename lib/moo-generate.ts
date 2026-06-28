import type { MooStats } from "@/lib/moo-captions";

/**
 * Self-replenishing caption material so the channel never runs dry without
 * someone hand-adding lines. Two engines here, on top of the curated static
 * pool in data/moo-captions.json:
 *
 *   1. generateCaption() — combinatorial. Banks of interchangeable fragments
 *      (cow nouns x his ribbed habits x stats x cow-virtues x sign-offs) run
 *      through 16 multi-fragment patterns = well over 100k distinct, readable
 *      lines (no thin single-bank templates). Add one fragment, get hundreds
 *      more combinations for free.
 *
 *   2. activityCaptions() — pulls his ACTUAL recent M+ runs (from Raider.IO via
 *      getBoobStats) and writes lines about what he literally just did. Fresh
 *      every week because it tracks real activity, not a fixed list.
 *
 * All output keeps the {boob}/{kuja} tokens so renderCaption() handles mentions.
 */

const COW = [
  "this cow", "this heifer", "this coo", "that magnificent beast",
  "the prize bull", "today's cow", "this fine animal", "this hairy lad",
  "this contented cow", "the herd's finest", "this absolute unit",
  "this Highland legend", "this dappled heifer", "this four-stomached scholar",
  "this pasture philosopher", "this bovine icon", "this grass connoisseur",
  "this serene ruminant", "this majestic ox", "this fuzzy tank",
  "this meadow veteran", "this chill cud-chewer", "this horned gentleman",
  "this unbothered beast", "this field marshal", "this dignified bovine",
  "this shaggy genius", "this barnyard royal", "this zen heifer",
  "this calm, collected cow", "this glorious beef boy", "this thousand-pound icon",
  "this pasture sage", "this unflappable steer", "this wise old cow",
];

// Past tense — for "{boob} ___" lines.
const FAIL_PAST = [
  "stood in the fire", "pulled before the tank", "ate every swirly",
  "found the one void zone", "facetanked the boss", "ignored the timer",
  "parked in Sanguine", "missed the interrupt", "stood in the bad",
  "kissed the frontal", "bubble-hearthed at 90%", "LOS'd his own healer",
  "body-blocked the kick", "ran it back into the pack", "side-stepped into the swirl",
  "saved cooldowns for the loot screen", "stood in Spiteful", "tunneled the wrong mob",
  "forgot he had a health potion", "woke the patrol", "stood in Storming",
  "ate the cleave headfirst", "face-pulled the boss", "dropped the orb",
  "stood in Volcanic", "walked into the trap", "stood in Explosive",
  "pulled with zero cooldowns", "died to fall damage", "stacked Necrotic to the moon",
  "greeded one more cast", "ate a frontal he could clearly see",
  "stood still through the swirlies", "chained two avoidable deaths",
  "pulled the entire room", "took the portal at 4% boss HP",
];

const STAT = [
  "uptime", "positioning", "survivability", "mechanics", "defensive cooldowns",
  "situational awareness", "self-preservation", "footwork", "threat management",
  "cooldown usage", "swirl-dodging", "interrupt timing", "pull planning",
  "danger sense", "spatial awareness", "damage avoidance", "reaction time",
  "map awareness", "hazard recognition", "object permanence", "pathing",
  "decision-making", "tempo control", "discipline", "spatial reasoning",
  "will to live",
];

const VIRTUE = [
  "never stands in fire", "dodges every puddle", "has flawless uptime",
  "respects the pull timer", "knows exactly what grass is",
  "has never once died to Sanguine", "keeps its hooves out of the bad",
  "has perfect parses", "always sidesteps the swirl", "never greeds a mechanic",
  "never face-pulls", "saves cooldowns for when they matter",
  "has impeccable positioning", "never stands in the frontal",
  "interrupts on time, every time", "never pulls extra",
  "always knows where its feet are", "never eats an avoidable",
  "has never died to a swirly", "moves out instantly", "plays it clean",
  "never tunnels", "keeps perfect spacing", "reads every cast bar",
  "is never caught out of line of sight", "respects every mechanic",
  "never panic-bubbles", "stays alive without trying",
  "keeps a flawless death log", "treats fire like lava",
];

const LOVE = [
  "We love him.", "What a guy.", "Beloved regardless.", "Never change, {boob}.",
  "Icon.", "King.", "Our boy.", "Legend.", "GOAT.", "Still our favorite.",
  "Couldn't raid without him.", "The realm's finest.", "No notes.",
  "A national treasure.", "Carry him forever.", "Worth every wipe.",
  "Heart of the guild.", "Simply him.", "Unkillable spirit, very killable character.",
  "Foundational guy.", "Somehow essential.", "Him, and only him.",
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

// Templates lean on MULTIPLE fragment banks so each one yields hundreds-to-
// thousands of distinct lines (no thin single-bank patterns).
const PATTERNS: ((f: Frag) => string)[] = [
  (f) => `${cap(f.cow)} has better ${f.stat} than {boob}. And it's a cow.`,
  (f) => `{boob} ${f.fail}. ${cap(f.cow)} would never. ${f.love}`,
  (f) => `${cap(f.cow)} ${f.virtue}. {boob} ${f.fail}. Spot the difference.`,
  (f) => `Daily moo. ${cap(f.cow)} sends regards to its cousin {boob}.`,
  (f) => `One of these ${f.virtue}; the other ${f.fail}. One of them is {boob}.`,
  (f) => `{boob} ${f.fail} again. ${cap(f.cow)} watched in quiet disbelief.`,
  (f) => `${cap(f.cow)}: elite ${f.stat}. {boob}: ${f.love}`,
  (f) =>
    `Gave ${f.cow} and {boob} the same ${f.stat} test. ${cap(f.cow2)} won.`,
  (f) =>
    `${cap(f.cow)} ${f.virtue} and asks for nothing. {boob} ${f.fail} and asks for a rez.`,
  (f) => `Scoreboard — ${f.cow}: ${f.virtue}. {boob}: ${f.fail}. ${f.love}`,
  (f) =>
    `Even ${f.cow} has better ${f.stat} than {boob}, and it eats grass for a living.`,
  (f) =>
    `Today in the pasture: ${f.cow} ${f.virtue}. Today in the key: {boob} ${f.fail}.`,
  (f) => `${cap(f.cow)} ${f.virtue}. {boob}? {boob} ${f.fail}.`,
  (f) =>
    `Meanwhile ${f.cow} ${f.virtue} — no deaths, no excuses, no {boob} energy.`,
  (f) => `${cap(f.cow)} would clear the key clean. {boob} ${f.fail}. ${f.love}`,
  (f) => `{boob} ${f.fail}. ${f.love} ${cap(f.cow)} remains undefeated.`,
];

/** One freshly composed caption (with {boob} tokens). Effectively unbounded. */
export function generateCaption(): string {
  const cow = pick(COW);
  // Second cow must differ from the first so the "X and {boob}… X won" template
  // never names the same cow twice.
  let cow2 = pick(COW);
  while (cow2 === cow) cow2 = pick(COW);
  const f: Frag = {
    cow,
    cow2,
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
 *
 * Each line carries a `key` that's the same for every caption about the same
 * run (dungeon + level), so the post deduper treats "timed X +N" and "fresh off
 * a +N X" as one topic — two consecutive posts can't both be about his lone
 * recent run dressed up two different ways.
 */
export function activityCaptions(stats: MooStats): { text: string; key: string }[] {
  const out: { text: string; key: string }[] = [];
  for (const r of stats.recentRuns ?? []) {
    const key = `activity:${r.dungeon}:${r.level}:${r.timed ? "t" : "d"}`;
    if (r.timed) {
      out.push({
        text: `{boob} timed ${r.dungeon} +${r.level} this week. Respectable, for a cow.`,
        key,
      });
      out.push({
        text: `Fresh off a +${r.level} ${r.dungeon}, {boob} returns to the pasture a hero.`,
        key,
      });
    } else {
      out.push({
        text: `{boob} bricked— sorry, "depleted" ${r.dungeon} +${r.level}. The herd sends support.`,
        key,
      });
    }
  }
  return out;
}
