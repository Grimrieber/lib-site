import type { Character, Role, WowClass } from "./types";

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
