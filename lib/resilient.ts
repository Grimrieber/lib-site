import type { ResilientAchievement } from "./types";

/**
 * Resilient records: what we keep, and what a rebuild is allowed to change.
 *
 * Two rules, both learned the hard way at the MN S1->S2 rollover.
 *
 * 1. A recompute may only ADD or RAISE a record, never erase one. The snapshot
 *    builder used to drop any character it could not recompute; at the flip the
 *    run history reset, every character read as "active", nothing recomputed
 *    against an empty new-season pool, and the board went from 32 entries (top
 *    keys 21, 20, 20) to 1 in a single build. Failing to compute is not
 *    evidence that a milestone was never earned.
 *
 * 2. Records are per SEASON, not per character. Resilient is a season-scoped
 *    achievement against a season-scoped dungeon pool - the achievements are
 *    literally named "Midnight Season 2: Resilient Keystone 12". Keeping only a
 *    character's highest-EVER tier looks right until a board is scoped to the
 *    current season: someone holding Resilient 21 from last season who earns 12
 *    this season would keep the 21, the season filter would drop it as history,
 *    and they would never appear on this season's board at all.
 *
 * So the store keeps one record per character PER SEASON, and callers filter to
 * whichever season they are displaying (see currentSeasonResilient).
 */

/** Stable identity for a character across snapshots. */
export function resilientKey(realmSlug: string, name: string): string {
  return `${realmSlug}:${name}`.toLowerCase();
}

/** Newest-earned first - the order the boards render in. */
function byEarnedDesc(a: ResilientAchievement, b: ResilientAchievement): number {
  return new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime();
}

/** True when a record belongs to the season starting at `seasonStartsAt`.
 *  Unknown boundary or unparseable date => treated as current, so a record is
 *  never binned as history on missing information. */
function isCurrentSeason(
  entry: ResilientAchievement,
  seasonStartsAt: number | null | undefined,
): boolean {
  if (seasonStartsAt == null || !Number.isFinite(seasonStartsAt)) return true;
  const t = Date.parse(entry.earnedAt ?? "");
  if (!Number.isFinite(t)) return true;
  return t >= seasonStartsAt;
}

/**
 * Merge freshly-computed records over the standing ones.
 *
 * Bucketed by character AND season, so this season's record stands alongside a
 * bigger one from last season instead of being suppressed by it. Within a
 * bucket the higher tier wins; equal tiers keep the ORIGINAL entry so
 * `earnedAt` stays the date the milestone was actually reached rather than
 * drifting forward on every rebuild.
 *
 * Passing an empty `fresh` is the "could not compute anything this cycle" case
 * (empty dungeon pool, unstable pool size, RIO outage). It must be a no-op, not
 * a wipe.
 *
 * Nothing is pruned here. Records are deliberately NOT scoped to the active
 * roster: that roster is an ACTIVITY filter (a key within 30 days, or a score
 * over the pusher threshold), so scoping to it deleted the permanent records of
 * anyone who simply stopped playing for a month - it quietly took the restored
 * board from 32 entries to 17 as the roster contracted after the season reset.
 * Deciding who to SHOW belongs at display time, not in the store.
 */
export function reconcileResilient(
  priors: ResilientAchievement[],
  fresh: ResilientAchievement[] = [],
  seasonStartsAt?: number | null,
): ResilientAchievement[] {
  const bucketOf = (e: ResilientAchievement) =>
    `${resilientKey(e.runner.realmSlug, e.runner.name)}@${
      isCurrentSeason(e, seasonStartsAt) ? "current" : "past"
    }`;

  const best = new Map<string, ResilientAchievement>();
  const consider = (entry: ResilientAchievement) => {
    const key = bucketOf(entry);
    const standing = best.get(key);
    if (!standing || entry.level > standing.level) best.set(key, entry);
  };

  // Standing records first, so an equal-tier fresh entry cannot overwrite the
  // original earnedAt.
  for (const entry of priors) consider(entry);
  for (const entry of fresh) consider(entry);

  return [...best.values()].sort(byEarnedDesc);
}

/**
 * Scope a Resilient board to the CURRENT season.
 *
 * The stored list is cumulative across seasons by design, so anything showing
 * "this season's" Resilient must filter here rather than assume the list is
 * already current.
 *
 * Fails OPEN when the season boundary is unknown, matching raidBelongsToSeason:
 * without a boundary we cannot tell old from new, and silently emptying a board
 * is worse than showing a superset.
 */
export function currentSeasonResilient(
  entries: ResilientAchievement[],
  seasonStartsAt: number | null | undefined,
): ResilientAchievement[] {
  return entries.filter((e) => isCurrentSeason(e, seasonStartsAt));
}
