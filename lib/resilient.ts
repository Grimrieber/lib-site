import type { ResilientAchievement } from "./types";

/**
 * Resilient is a PERMANENT milestone: once a character has cleared every active
 * dungeon at a level, that record stands. Nothing about a later cycle should be
 * able to take it away.
 *
 * That guarantee used to hold only by accident. The snapshot builder reused a
 * prior entry when a character was IDLE (their `lastRunAt` had not moved), and
 * recomputed everyone else. At a season rollover the run history resets, so
 * every character reads as active, nothing is idle, and there are no runs in
 * the new season to recompute from - so a character landed in neither bucket
 * and their record was silently dropped. The MN S1->S2 flip took the board from
 * 32 entries (top keys 21, 20, 20) down to 1 in a single build.
 *
 * The rule these helpers enforce: a recompute may only ADD or RAISE a record,
 * never erase one. Failing to compute is not evidence that a milestone was
 * never earned.
 */

/** Stable identity for a character across snapshots. */
export function resilientKey(realmSlug: string, name: string): string {
  return `${realmSlug}:${name}`.toLowerCase();
}

/** Newest-earned first - the order the boards render in. */
function byEarnedDesc(a: ResilientAchievement, b: ResilientAchievement): number {
  return new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime();
}

/**
 * Merge freshly-computed records over the standing ones.
 *
 * `rosterKeys` scopes the board to the CURRENT roster, so a character who left
 * the guild drops off - that is intentional and is the only way an entry may
 * disappear. Everyone still on the roster keeps their prior record unless this
 * cycle computed a HIGHER one.
 *
 * Passing an empty `fresh` is the "could not compute anything this cycle" case
 * (empty dungeon pool, unstable pool size, RIO outage). It must be a no-op, not
 * a wipe.
 */
export function reconcileResilient(
  rosterKeys: Iterable<string>,
  priorByKey: Map<string, ResilientAchievement>,
  fresh: ResilientAchievement[] = [],
): ResilientAchievement[] {
  const best = new Map<string, ResilientAchievement>();

  // Standing records first, for every character still on the roster.
  for (const key of rosterKeys) {
    const prior = priorByKey.get(key);
    if (prior) best.set(key, prior);
  }

  // A fresh computation only wins when it beats the standing record. Equal
  // levels keep the ORIGINAL entry so `earnedAt` stays the date the milestone
  // was actually reached rather than drifting forward on every rebuild.
  for (const entry of fresh) {
    const key = resilientKey(entry.runner.realmSlug, entry.runner.name);
    const standing = best.get(key);
    if (!standing || entry.level > standing.level) best.set(key, entry);
  }

  return [...best.values()].sort(byEarnedDesc);
}
