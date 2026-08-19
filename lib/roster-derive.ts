import type { Character, CharacterDetail, Role, WowClass } from "./types";

/**
 * Shared roster derivations — one definition each, so the same computation
 * isn't re-implemented (and allowed to drift) across components. Role bucketing
 * lives in lib/specs.ts (preferredRole); membership/score merging lives in
 * lib/raiderio.ts (getRosterEnrichments builds the canonical enrichedRoster).
 */

/** A character is "active this week" if they ran an M+ key within the last 7
 *  days. Shared by the roster grid's per-card badge and the hero panel's
 *  active-count so the two can never disagree. */
export const ACTIVE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function isActiveThisWeek(c: Pick<Character, "lastRunAt">): boolean {
  return !!c.lastRunAt && Date.now() - c.lastRunAt < ACTIVE_WEEK_MS;
}

/**
 * Overlay the CORE scores from the fresh snapshot-roster character onto a
 * (possibly hour+-stale) precomputed CharacterDetail, so every page that
 * renders the detail — the character sheet header AND the compare view — shows
 * the SAME M+ score / role scores / achievement points as the leaderboard.
 *
 * Canonical rule (see the module header): "core" comes from the hourly
 * snapshot.roster, which enrichRoster keeps ≤2h-fresh via its active-staleness
 * override; the per-character Redis detail precompute owns only detail-specific
 * data (best keys, gear, talents, raids), which has no snapshot equivalent and
 * refreshes on its own gate. Defined ONCE here so the character page and compare
 * can never drift (they used to — compare showed a stale M+ score while the
 * leaderboard showed the fresh one). Falls through untouched when no roster
 * entry is supplied.
 */
export function withFreshRosterCore(
  detail: CharacterDetail,
  rosterChar:
    | Pick<
        Character,
        | "mythicPlusScore"
        | "mythicPlusScoreColor"
        | "roleScores"
        | "achievementPoints"
      >
    | undefined,
): CharacterDetail {
  if (!rosterChar) return detail;
  return {
    ...detail,
    mythicPlusScore: rosterChar.mythicPlusScore ?? detail.mythicPlusScore,
    mythicPlusScoreColor:
      rosterChar.mythicPlusScoreColor ?? detail.mythicPlusScoreColor,
    roleScores: rosterChar.roleScores ?? detail.roleScores,
    achievementPoints:
      rosterChar.achievementPoints ?? detail.achievementPoints,
  };
}

const ALL_CLASSES: WowClass[] = [
  "deathknight",
  "demonhunter",
  "druid",
  "evoker",
  "hunter",
  "mage",
  "monk",
  "paladin",
  "priest",
  "rogue",
  "shaman",
  "warlock",
  "warrior",
  "unknown",
];

/** Count roster members per class — full record (every class zeroed) so callers
 *  can iterate a fixed class order. Shared by ClassComposition (bars) and
 *  ClassCompositionDonut so the two visuals always count identically. */
export function countByClass(roster: Character[]): Record<WowClass, number> {
  const out = Object.fromEntries(
    ALL_CLASSES.map((c) => [c, 0]),
  ) as Record<WowClass, number>;
  for (const c of roster) out[c.class] = (out[c.class] ?? 0) + 1;
  return out;
}

/** Count roster members per (raw active-spec) role. */
export function countByRole(roster: Character[]): Record<Role, number> {
  const out: Record<Role, number> = { tank: 0, healer: 0, dps: 0 };
  for (const c of roster) out[c.role] = (out[c.role] ?? 0) + 1;
  return out;
}
