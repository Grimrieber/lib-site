/**
 * Manual Resilient overrides — escape hatch for when RIO's data is missing
 * an older timed run and the algorithm's computed earnedAt is too recent.
 *
 * Background: the popup uses each character's full timed-run history (RIO
 * public profile + raider.io internal role-partitioned endpoint) to find
 * the date their LAST lagging dungeon crossed their Resilient level. RIO
 * caps every run-list at ~10 entries per field, so older +X timed runs
 * can be invisible — once a character pushes a dungeon to +X+1, the +X
 * run gets displaced from `best_runs` and may not appear in any of the
 * other capped fields either. When that happens, the algorithm thinks the
 * tier was earned recently (using whatever recent run it CAN see at that
 * level), and the popup fires a false-positive.
 *
 * Add an entry below to either:
 *  - Force an explicit `earnedAt` timestamp (use when you know roughly
 *    when the tier was actually earned).
 *  - `hide: true` to remove the character from the popup AND top-3 list
 *    entirely (e.g. retired alts).
 *
 * Keys are character names — match exactly (case-sensitive) what RIO
 * returns. Mojibake names (like "AurorÃ¤") would need to match
 * the mojibake form; check snapshot.json's `resilient[].runner.name` if
 * unsure.
 */

export type ResilientOverride = {
  /** Force this exact earnedAt timestamp. ISO 8601 with milliseconds and Z
   *  recommended, e.g. "2026-04-15T00:00:00.000Z". */
  earnedAt?: string;
  /** Drop the character from both the popup feed and the top-3 leaderboard. */
  hide?: boolean;
};

export const RESILIENT_OVERRIDES: Record<string, ResilientOverride> = {
  // Kujatas earned R17 weeks ago — but his +17 NPX timed runs from earlier
  // in the season are not in any RIO data field, so the algorithm sees only
  // his 5/25 NPX run and (incorrectly) treats that as the earned date.
  // Uncomment + edit the date once you know it:
  // Kujatas: { earnedAt: "2026-04-15T00:00:00.000Z" },
};
