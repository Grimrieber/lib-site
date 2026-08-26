/**
 * ROLLOVER HARNESS - the states a season or expansion boundary creates,
 * replayed against the real code paths.
 *
 *   npm run test:rollover
 *
 * WHY THIS EXISTS
 *
 * The Midnight S1->S2 rollover was "fixed" three times before it worked. Each
 * fix was verified against data as it looked BEFORE the flip, and pre-flip data
 * structurally cannot produce the states that break things: every score
 * legitimately 0, last season's raids still listed in raid_progression, a
 * released raid with no kills, a descriptively-named slug. Every one of those
 * is a fixture below.
 *
 * These are pure-function tests on purpose - no network, no snapshot, no
 * Upstash - so they run in CI and fail loudly the moment a rollover assumption
 * regresses, instead of at 15:00 UTC on launch day.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { shapeSeasonScores, type RioSeasonEntry } from "../lib/season-scores.js";
import {
  raidBelongsToSeason,
  selectMainSeasons,
} from "../lib/season-context.js";
import { aggregateSeasonTiers } from "../lib/season.js";
import { isCurrentSeasonTitle } from "../lib/config.js";
import {
  currentSeasonResilient,
  reconcileResilient,
} from "../lib/resilient.js";
import type {
  Boss,
  RaidProgressionGroup,
  ResilientAchievement,
  TierState,
} from "../lib/types.js";

const seasonEntry = (
  season: string,
  all: number,
  roles: Partial<{ tank: number; healer: number; dps: number }> = {},
): RioSeasonEntry => ({
  season,
  scores: {
    all,
    tank: roles.tank ?? 0,
    healer: roles.healer ?? 0,
    dps: roles.dps ?? 0,
  },
  segments: { all: { score: all, color: all > 0 ? "#ff8000" : "#ffffff" } },
});

// ---------------------------------------------------------------------------
// M+ score parsing across a season boundary
// ---------------------------------------------------------------------------

test("day one of a new season reports the CURRENT season, not the last one", () => {
  // RIO returns `:current` first. On launch day it is a genuine 0, and 0 is
  // what we show - the boards rank this season's running, not last season's.
  const out = shapeSeasonScores([
    seasonEntry("season-mn-2", 0),
    seasonEntry("season-mn-1", 2483.6, { dps: 2483.6 }),
  ]);
  // The original bug filtered `score > 0` BEFORE taking index 0, which slid the
  // pointer onto season-mn-1 and republished last season's final as current.
  assert.equal(out.score, 0, "never falls back to a previous season");
  assert.equal(out.roleScores.dps, 0, "role scores come from the current season too");
});

test("a live current-season score is reported as-is", () => {
  const out = shapeSeasonScores([
    seasonEntry("season-mn-2", 412.3, { dps: 412.3 }),
    seasonEntry("season-mn-1", 2483.6, { dps: 2483.6 }),
  ]);
  assert.equal(out.score, 412.3);
  assert.equal(out.roleScores.dps, 412.3);
});

test("a new character in a new season reports 0", () => {
  const out = shapeSeasonScores([seasonEntry("season-mn-2", 0)]);
  assert.equal(out.score, 0);
});

test("current season stays in history at 0; unplayed seasons are dropped", () => {
  const out = shapeSeasonScores([
    seasonEntry("season-mn-2", 0),
    seasonEntry("season-mn-1", 2483.6),
    seasonEntry("season-df-1", 0),
  ]);
  const slugs = out.seasonScores.map((x) => x.slug);
  assert.ok(slugs.includes("season-mn-2"), "current season visible at 0");
  assert.ok(!slugs.includes("season-df-1"), "never-played season dropped");
});

test("the duplicate :current entry is de-duped keep-first", () => {
  // SEASON_FIELD asks for `:current` AND the explicit slug, so the current
  // season comes back twice.
  const out = shapeSeasonScores([
    seasonEntry("season-mn-2", 500),
    seasonEntry("season-mn-2", 500),
    seasonEntry("season-mn-1", 2483.6),
  ]);
  const mn2 = out.seasonScores.filter((x) => x.slug === "season-mn-2");
  assert.equal(mn2.length, 1);
});

test("a descriptively-named season is handled like any other", () => {
  // The raid side already broke on "the-venomous-abyss". Nothing here may
  // assume a season is named season-<abbrev>-<number>.
  const out = shapeSeasonScores([
    seasonEntry("season-the-shadow-war", 1500),
    seasonEntry("season-mn-2", 900),
  ]);
  assert.equal(out.score, 1500, "index 0 is authoritative whatever it is called");
});

test("an empty payload degrades to zero rather than throwing", () => {
  const out = shapeSeasonScores(undefined);
  assert.equal(out.score, 0);
  assert.deepEqual(out.seasonScores, []);
});

// ---------------------------------------------------------------------------
// Raid-to-season attribution
// ---------------------------------------------------------------------------

const SEASON_START = Date.parse("2026-08-18T15:00:00Z");

test("a raid opening a week BEFORE its season still belongs to it", () => {
  // MN Tier 1 opened 2026-03-17 for a season starting 2026-03-24. A naive
  // `>= seasonStart` files live content as history.
  const s1Start = Date.parse("2026-03-24T15:00:00Z");
  const tierOpen = Date.parse("2026-03-17T15:00:00Z");
  assert.equal(raidBelongsToSeason(tierOpen, s1Start), true);
});

test("last season raids are excluded from the current season", () => {
  assert.equal(
    raidBelongsToSeason(Date.parse("2026-03-17T15:00:00Z"), SEASON_START),
    false,
    "MN Tier 1 is not Season 2 content",
  );
  assert.equal(
    raidBelongsToSeason(Date.parse("2026-06-16T15:00:00Z"), SEASON_START),
    false,
    "a mid-S1 side raid is not Season 2 content either",
  );
});

test("this season raids are included", () => {
  assert.equal(raidBelongsToSeason(SEASON_START, SEASON_START), true);
});

test("missing dates fail OPEN, never hiding earned progress", () => {
  assert.equal(raidBelongsToSeason(null, SEASON_START), true);
  assert.equal(raidBelongsToSeason(SEASON_START, null), true);
  assert.equal(raidBelongsToSeason(NaN, SEASON_START), true);
});

// ---------------------------------------------------------------------------
// Season discovery
// ---------------------------------------------------------------------------

test("event/variant seasons are dropped, main seasons kept", () => {
  const kept = selectMainSeasons([
    "season-mn-2",
    "season-mn-1-break-the-meta",
    "season-mn-1",
    "season-tww-3-cutoffs",
    "season-tww-3-legion-remix",
    "season-tww-3",
  ]);
  assert.deepEqual(kept, ["season-mn-2", "season-mn-1", "season-tww-3"]);
});

test("a descriptively-named main season survives the variant filter", () => {
  const kept = selectMainSeasons([
    "season-the-shadow-war",
    "season-the-shadow-war-cutoffs",
    "season-mn-2",
  ]);
  assert.deepEqual(kept, ["season-the-shadow-war", "season-mn-2"]);
});

// ---------------------------------------------------------------------------
// Season aggregate across a tier rollover
// ---------------------------------------------------------------------------

const boss = (slug: string): Boss => ({ slug, name: slug }) as Boss;

const tier = (over: Partial<TierState>): TierState =>
  ({
    raidName: "The Venomous Abyss",
    difficulty: "Mythic",
    totalBosses: 8,
    killed: 0,
    bosses: ["a", "b", "c"].map(boss),
    killedSlugs: [],
    ...over,
  }) as TierState;

test("the aggregate keeps a per-raid breakdown so next boss is attributable", () => {
  const primary = tier({});
  const extra = {
    tierSlug: "tier-mn-1",
    tiers: [
      tier({
        raidName: "MN Tier 1",
        killed: 3,
        totalBosses: 9,
        bosses: ["x", "y", "z"].map(boss),
        killedSlugs: ["x", "y", "z"],
      }),
    ],
  } as RaidProgressionGroup;

  const [agg] = aggregateSeasonTiers([primary], [extra], "Midnight");
  assert.equal(agg.killed, 3, "kills sum");
  // Without the breakdown, "first un-killed boss" resolves to boss #1 of a raid
  // nobody entered while the kill count comes from a different raid entirely -
  // that is the fake-progging bug.
  assert.ok(agg.subRaids && agg.subRaids.length === 2, "per-raid segments kept");
  const owning = agg.subRaids!.find((sr) =>
    sr.bosses.some((b) => b.slug === "a"),
  );
  assert.equal(owning?.killed, 0, "the unentered raid reports its OWN 0 kills");
});

test("with no extra raids the aggregate is a passthrough", () => {
  const primary = tier({ killed: 2 });
  const [agg] = aggregateSeasonTiers([primary], [], "Midnight");
  assert.equal(agg.killed, 2);
  assert.equal(agg.totalBosses, 8, "no phantom bosses from a retired season");
});

// ---------------------------------------------------------------------------
// Resilient: a permanent milestone must survive a season boundary
// ---------------------------------------------------------------------------

const resilient = (
  name: string,
  level: number,
  earnedAt = "2026-06-22T00:00:00.000Z",
): ResilientAchievement =>
  ({
    runner: { name, realmSlug: "skullcrusher", class: "priest" },
    level,
    earnedAt,
    score: 3000,
  }) as ResilientAchievement;

test("a season flip with nothing recomputable keeps every standing record", () => {
  // The exact MN S1->S2 failure: run history resets, so nobody is idle and
  // nothing recomputes. The board went 32 -> 1 in one build.
  const priors = [
    resilient("Alpha", 21),
    resilient("Beta", 20),
    resilient("Gamma", 16),
  ];
  const out = reconcileResilient(priors, [], SEASON_START);
  assert.equal(out.length, 3, "no record is dropped for being unrecomputable");
  assert.deepEqual(
    out.map((e) => e.level).sort((a, b) => b - a),
    [21, 20, 16],
    "the 21 and 20 survive rather than leaving only the lowest",
  );
});

test("a record is NOT pruned when its owner falls off the active roster", () => {
  // The active roster is an activity filter. Scoping the store to it deleted
  // the permanent records of anyone who stopped playing for a month - it took
  // the restored board from 32 entries to 17 as the roster contracted.
  const out = reconcileResilient([resilient("WentQuiet", 21)], [], SEASON_START);
  assert.equal(out.length, 1);
});

test("this season's record stands alongside a bigger one from last season", () => {
  // Without per-season bucketing, a holder of last season's 21 who earns 12
  // this season keeps the 21, the season filter drops it as history, and they
  // never appear on this season's board at all.
  const priors = [resilient("Alpha", 21, "2026-08-04T00:00:00.000Z")];
  const fresh = [resilient("Alpha", 12, "2026-08-24T00:00:00.000Z")];
  const merged = reconcileResilient(priors, fresh, SEASON_START);
  assert.equal(merged.length, 2, "both seasons kept");
  const current = currentSeasonResilient(merged, SEASON_START);
  assert.deepEqual(current.map((e) => e.level), [12], "this season shows the 12");
});

test("a higher fresh tier raises this season's record", () => {
  const out = reconcileResilient(
    [resilient("Alpha", 12, "2026-08-20T00:00:00.000Z")],
    [resilient("Alpha", 16, "2026-08-24T00:00:00.000Z")],
    SEASON_START,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 16);
});

test("a lower fresh tier never demotes within a season", () => {
  const out = reconcileResilient(
    [resilient("Alpha", 16, "2026-08-20T00:00:00.000Z")],
    [resilient("Alpha", 8, "2026-08-24T00:00:00.000Z")],
    SEASON_START,
  );
  assert.equal(out[0].level, 16);
});

test("an equal tier keeps the ORIGINAL earnedAt", () => {
  // Otherwise the date drifts forward on every rebuild and the milestone
  // stops meaning "when they actually did it".
  const out = reconcileResilient(
    [resilient("Alpha", 21, "2026-08-20T00:00:00.000Z")],
    [resilient("Alpha", 21, "2026-08-24T00:00:00.000Z")],
    SEASON_START,
  );
  assert.equal(out[0].earnedAt, "2026-08-20T00:00:00.000Z");
});

test("a first-time earner with no prior record is added", () => {
  const out = reconcileResilient([], [resilient("Alpha", 12, "2026-08-24T00:00:00.000Z")], SEASON_START);
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 12);
});

test("the Resilient board is scoped to the CURRENT season", () => {
  // Resilient is a per-season achievement against a per-season dungeon pool
  // ("Midnight Season 2: Resilient Keystone 12"). The stored list is cumulative
  // by design, so last season's keys must not sit on this season's board.
  const entries = [
    resilient("LastSeason", 21, "2026-08-04T00:00:00.000Z"),
    resilient("ThisSeason", 12, "2026-08-19T00:00:00.000Z"),
  ];
  const out = currentSeasonResilient(entries, SEASON_START);
  assert.deepEqual(out.map((e) => e.runner.name), ["ThisSeason"]);
});

test("an empty current-season board is correct, not a failure", () => {
  // Opening days of a season nobody has cleared the new pool yet. Showing
  // last season's 21 there is the bug; showing nothing is the truth.
  const out = currentSeasonResilient(
    [resilient("LastSeason", 21, "2026-08-04T00:00:00.000Z")],
    SEASON_START,
  );
  assert.equal(out.length, 0);
});

test("an unknown season boundary keeps every record rather than emptying", () => {
  const entries = [resilient("Alpha", 21, "2026-08-04T00:00:00.000Z")];
  assert.equal(currentSeasonResilient(entries, null).length, 1);
  assert.equal(currentSeasonResilient(entries, NaN).length, 1);
});

// ---------------------------------------------------------------------------
// Season titles across a boundary
// ---------------------------------------------------------------------------

test("the authoritative season number beats a descriptively-named slug", () => {
  // With only the slug to go on, `season-the-shadow-war` yields NaN and the
  // filter fails open - parading every past season's title holders as current.
  assert.equal(
    isCurrentSeasonTitle("Midnight Season 1", "Midnight", "season-the-shadow-war"),
    true,
    "slug-only really does fail open (documents the hazard)",
  );
  assert.equal(
    isCurrentSeasonTitle("Midnight Season 1", "Midnight", "season-the-shadow-war", 3),
    false,
    "with the real season number, last season's title is correctly excluded",
  );
});

test("the current season's own title still shows", () => {
  assert.equal(
    isCurrentSeasonTitle("Midnight Season 2", "Midnight", "season-mn-2", 2),
    true,
  );
});

test("a same-numbered title from another expansion is excluded", () => {
  assert.equal(
    isCurrentSeasonTitle("Dragonflight Season 2", "Midnight", "season-mn-2", 2),
    false,
  );
});
