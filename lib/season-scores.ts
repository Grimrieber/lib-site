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
  /** Set when `score` is a PRIOR season's final, carried because the current
   *  season has no score yet. Holds that season's slug (e.g. "season-mn-1"). */
  carriedFromSeason?: string;
};

/** Single source of truth for turning RIO's `mythic_plus_scores_by_season`
 *  into the score we display. Every read path funnels through here so the
 *  roster, the leaderboards and the character sheet can never disagree.
 *
 *  We always request `:current` FIRST, so index 0 is RIO's authoritative
 *  current season — including on the day a season opens, when every character
 *  legitimately sits at 0.
 *
 *  That 0 is real data, not missing data. The previous code filtered
 *  `score > 0` BEFORE taking index 0, which silently slid the "current"
 *  pointer onto an older season and republished last season's final score as
 *  though it were this season's. At the 2026-08-18 MN S2 rollover that put 25
 *  members' S1 scores next to 60 members' blanks on the same roster.
 *
 *  Instead: keep the current season authoritative, and when it has no score
 *  yet, carry the newest prior season's final forward EXPLICITLY via
 *  `carriedFromSeason` so the UI can badge it and swap to live season data
 *  per-character the moment they earn a point.
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

  // Per-season history for the character sheet. Drop never-played seasons,
  // but ALWAYS keep the current one (a 0 there is meaningful), and de-dup the
  // current season — it appears twice, once from `:current` and once from its
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

  if (scoreOf(current) > 0) {
    return {
      score: scoreOf(current),
      color: colorOf(current),
      roleScores: rolesOf(current),
      seasonScores,
    };
  }

  // Nothing this season yet — carry the newest prior season that has a score.
  const prior = entries
    .slice(1)
    .find((s) => s.season !== currentSlug && scoreOf(s) > 0);
  if (!prior) {
    return {
      score: 0,
      roleScores: rolesOf(current),
      seasonScores,
    };
  }
  return {
    score: scoreOf(prior),
    color: colorOf(prior),
    // Role scores come from the SAME season as the score we show, so
    // preferred-spec and role-board ranking stay internally consistent.
    roleScores: rolesOf(prior),
    seasonScores,
    carriedFromSeason: prior.season,
  };
}

