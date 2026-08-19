import { expansionLabelFromSlug } from "./config";
import type { SeasonScore } from "./types";

/**
 * Pure parsing of Raider.IO's per-season M+ scores. No fetching, no caching, no
 * snapshot access — so it can be exercised directly by the rollover harness
 * against synthesized post-flip payloads (see scripts/rollover-harness.mts).
 * That testability is the point: this logic broke at the S1->S2 rollover in a
 * way no amount of pre-flip data could have surfaced.
 */

/** Structural shape of one entry in RIO's `mythic_plus_scores_by_season`.
 *  Declared locally rather than imported from the API response type so this
 *  module stays free of the data layer. */
export type RioSeasonEntry = {
  season: string;
  scores?: { all?: number; tank?: number; healer?: number; dps?: number };
  segments?: { all?: { score?: number; color?: string } };
};

/** "season-mn-1" -> "Midnight Season 1". */
export function labelForSeasonSlug(slug: string): string {
  const parts = slug.replace(/^season-/, "").split("-");
  if (parts.length < 2) return slug;
  const exp = expansionLabelFromSlug(slug) ?? parts[0].toUpperCase();
  const num = parts[parts.length - 1];
  return `${exp} Season ${num}`;
}

export type ShapedSeasonScores = {
  score: number;
  color?: string;
  roleScores: { tank: number; healer: number; dps: number };
  seasonScores: SeasonScore[];
};

/**
 * Single source of truth for turning RIO's `mythic_plus_scores_by_season` into
 * the score we display. Every read path funnels through here so the roster, the
 * leaderboards and the character sheet can never disagree.
 *
 * We always request `:current` FIRST, so index 0 is RIO's authoritative current
 * season - including on the day a season opens, when every character
 * legitimately sits at 0.
 *
 * That 0 is real data, not missing data, and it is what we show. The original
 * bug filtered `score > 0` BEFORE taking index 0, which silently slid the
 * "current" pointer onto an older season and republished last season's final as
 * though it were this season's. Never fall back to a previous season here: a
 * character with no score yet has no score yet, and the boards should rank this
 * season's running, not last season's ghosts.
 */
export function shapeSeasonScores(
  raw: RioSeasonEntry[] | undefined,
): ShapedSeasonScores {
  const entries = raw ?? [];
  const scoreOf = (s: RioSeasonEntry | undefined) =>
    s?.segments?.all?.score ?? s?.scores?.all ?? 0;
  const colorOf = (s: RioSeasonEntry | undefined) => {
    const c = s?.segments?.all?.color;
    return c && c !== "#ffffff" ? c : undefined;
  };
  const rolesOf = (s: RioSeasonEntry | undefined) => ({
    tank: s?.scores?.tank ?? 0,
    healer: s?.scores?.healer ?? 0,
    dps: s?.scores?.dps ?? 0,
  });

  const current = entries[0];
  const currentSlug = current?.season;

  // Per-season history for the character sheet. Drop never-played seasons, but
  // ALWAYS keep the current one (a 0 there is meaningful), and de-dup the
  // current season - it appears twice, once from `:current` and once from its
  // explicit slug. Keep-first preserves the authoritative `:current` entry.
  const seen = new Set<string>();
  const seasonScores: SeasonScore[] = entries
    .map((s) => ({
      slug: s.season,
      label: labelForSeasonSlug(s.season),
      score: scoreOf(s),
      color: colorOf(s),
    }))
    .filter((s) => s.score > 0 || s.slug === currentSlug)
    .filter((s) => {
      if (seen.has(s.slug)) return false;
      seen.add(s.slug);
      return true;
    });

  return {
    score: scoreOf(current),
    color: colorOf(current),
    roleScores: rolesOf(current),
    seasonScores,
  };
}
