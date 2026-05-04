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
};

type SpecResolvable = {
  class: WowClass;
  spec: string;
  role: Role;
  roleScores: { tank: number; healer: number; dps: number };
  roleOverride?: Role;
};

/** The role this character scores highest in this season — i.e. what they
 *  actually play, regardless of whatever spec was active when RIO last
 *  refreshed. Tank/healer/dps in that priority order on ties. Honors
 *  manual `roleOverride` from ROSTER_PINS if present. */
export function preferredRole(c: {
  roleScores: { tank: number; healer: number; dps: number };
  roleOverride?: Role;
}): Role {
  if (c.roleOverride) return c.roleOverride;
  const { tank, healer, dps } = c.roleScores;
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

/** Preferred score — the highest of the role-bucketed scores. Used when
 *  display should match the spec (e.g. roster card "M+" stat alongside
 *  the preferred spec name). */
export function preferredScore(c: {
  roleScores: { tank: number; healer: number; dps: number };
  mythicPlusScore?: number;
}): number {
  const { tank, healer, dps } = c.roleScores;
  return Math.max(tank, healer, dps, c.mythicPlusScore ?? 0);
}
