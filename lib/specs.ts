import type { Role, WowClass } from "./types";

/**
 * Spec name for a given class+role. For tanks and healers each class has
 * exactly one spec, so role → spec is unambiguous. For DPS we leave the
 * mapping out: most DPS classes have multiple DPS specs (Hunter has BM /
 * MM / Survival, etc.) and we can't pick from the role-bucketed M+ score
 * alone — fall back to the active spec in that case.
 */
const ROLE_SPEC_BY_CLASS: Record<WowClass, Partial<Record<Role, string>>> = {
  deathknight: { tank: "Blood" },
  demonhunter: { tank: "Vengeance" },
  druid: { tank: "Guardian", healer: "Restoration" },
  evoker: { healer: "Preservation" },
  hunter: {},
  mage: {},
  monk: { tank: "Brewmaster", healer: "Mistweaver" },
  paladin: { tank: "Protection", healer: "Holy" },
  priest: { healer: "Holy" },
  rogue: {},
  shaman: { healer: "Restoration" },
  warlock: {},
  warrior: { tank: "Protection" },
  unknown: {},
};

type SpecResolvable = {
  class: WowClass;
  spec: string;
  role: Role;
  roleScores: { tank: number; healer: number; dps: number };
  roleOverride?: Role;
};

/**
 * How far the scores have to beat a manual `roleOverride` before the data
 * wins. The override is for when the scores CAN'T speak — at a season reset
 * every role score is 0 and the rule below would call the entire guild DPS —
 * so a small edge shouldn't overturn a deliberate pin. A different main,
 * though, is not a small edge: Pandidin was pinned as a tank, switched to
 * Mistweaver, and healed at 3,040 while the pin kept showing him as an 1,817
 * Brewmaster on the tank board. 1.2 sits far below that 67% gap and far above
 * the noise of someone who genuinely off-roles a few keys.
 */
const OVERRIDE_YIELD_RATIO = 1.2;

/** The role this character scores highest in this season — i.e. what they
 *  actually play, regardless of whatever spec was active when RIO last
 *  refreshed. Tank/healer/dps in that priority order on ties. A manual
 *  `roleOverride` from ROSTER_PINS wins while the scores are silent or close,
 *  and yields once they clearly disagree — see OVERRIDE_YIELD_RATIO. */
export function preferredRole(c: {
  roleScores: { tank: number; healer: number; dps: number };
  roleOverride?: Role;
}): Role {
  const { tank, healer, dps } = c.roleScores;
  if (c.roleOverride) {
    const best = Math.max(tank, healer, dps);
    // Nothing played yet this season: the pin is all we have.
    if (best <= 0) return c.roleOverride;
    const pinned = c.roleScores[c.roleOverride] ?? 0;
    if (best <= pinned * OVERRIDE_YIELD_RATIO) return c.roleOverride;
    // Fall through: they have demonstrably rerolled.
  }
  if (tank > healer && tank > dps && tank > 0) return "tank";
  if (healer > dps && healer > 0) return "healer";
  return "dps";
}

/** Spec name to display for this character — their preferred spec
 *  (highest M+ score role) rather than the spec that was active when
 *  RIO last refreshed. Falls back to the active spec for ambiguous
 *  cases (multi-DPS classes, no scores). */
export function preferredSpec(c: SpecResolvable): string {
  const role = preferredRole(c);
  if (role === c.role) return c.spec;
  return ROLE_SPEC_BY_CLASS[c.class]?.[role] ?? c.spec;
}

/** Spec name for a specific class+role pairing. Used when the role is
 *  fixed by context (e.g. the "Tanks" column on TopPerformers always
 *  wants the tank spec for that class). Falls back to the character's
 *  active spec when the class+role combo is ambiguous (e.g. DPS specs). */
export function specForClassRole(
  c: { class: WowClass; spec: string },
  role: Role,
): string {
  return ROLE_SPEC_BY_CLASS[c.class]?.[role] ?? c.spec;
}
