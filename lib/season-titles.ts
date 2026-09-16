/**
 * Mythic+ end-of-season accolade plumbing — the two pure decisions that decide
 * whether a star ever reaches a character's name.
 *
 * WHY THESE LIVE ALONE, OUT OF raiderio.ts
 *
 * An accolade is the one piece of data on this site whose arrival is NOT
 * announced by any of our freshness signals:
 *
 *   - It is granted for where a character FINISHED a season, so it lands days
 *     to weeks after the season already rolled over, when the holder has long
 *     since stopped running keys and `lastRunAt` has stopped moving.
 *   - It is worth ZERO achievement points, so `achievement_points` — the gate
 *     on the cached BNet tier data — never moves either.
 *   - It only reaches the BNet profile on the holder's next LOGOUT, so it can
 *     appear at an arbitrary time with nothing else about the character having
 *     changed.
 *
 * Both incremental gates therefore read "nothing changed" at precisely the
 * moment something did. That is how Totemtartt's Umbral Champion (Midnight
 * Season 1, earned 2026-09-15) stayed invisible on the site while it was
 * plainly visible in game, and the shape of the bug was invisible too — the
 * logic sat inside an async function that fetches ~2.67MB per character, so
 * nothing about it could be tested. These two functions are pure so the
 * harness can hold them to the post-flip states directly.
 */
import type {
  Character,
  CharacterSeasonTitle,
  SeasonTitleAward,
} from "./types";

/**
 * Should this top-scoring candidate's achievements be re-read this build?
 *
 * The cheap answer is "only if they ran a key since last time" — an accolade
 * comes from Mythic+, so nothing else can produce one. That is true of how it
 * is EARNED and false of when it is GRANTED, which is the distinction that
 * broke it. Inside the grant window we ignore the key gate for anyone not
 * already holding an accolade earned since the flip, which is self-limiting:
 * a holder is found once and then reuses like everybody else, and a non-holder
 * costs one fetch a build for a few weeks a season.
 *
 * @param lastRunAt      the candidate's newest key, this build
 * @param priorLastRunAt the same value from the previous build, or undefined
 *                       if they weren't on it
 * @param priorAward     the accolade we already recorded for them, if any
 * @param seasonStartsAt when the CURRENT season began — null when unknown
 * @param windowMs       how long after the flip to stay in grant watch
 */
export function needsAccoladeScan(opts: {
  lastRunAt: number | undefined;
  priorLastRunAt: number | undefined;
  priorAward: Pick<SeasonTitleAward, "earnedAt"> | undefined;
  seasonStartsAt: number | null;
  windowMs: number;
  now?: number;
}): boolean {
  const { lastRunAt, priorLastRunAt, priorAward, seasonStartsAt, windowMs } =
    opts;
  const now = opts.now ?? Date.now();

  // Never seen before, or they ran a key since the last build.
  if (priorLastRunAt === undefined) return true;
  if ((lastRunAt ?? 0) !== priorLastRunAt) return true;

  // An unknown season start fails CLOSED here on purpose: without a boundary
  // there is no window to be inside, and re-scanning the whole candidate list
  // every build is the cost this gate exists to avoid.
  if (seasonStartsAt == null) return false;
  if (now - seasonStartsAt >= windowMs) return false;

  // In the window. Anyone whose newest accolade predates the flip (or who has
  // none at all) could still be waiting on this season's grant.
  return !priorAward || priorAward.earnedAt < seasonStartsAt;
}

/**
 * Fold the snapshot's accolade board into one character's star list, newest
 * first, de-duplicated by season.
 *
 * The stars used to come only from that character's cached BNet tier data,
 * which is gated on achievement points — so a 0-point accolade could never
 * invalidate it and the empty pre-accolade entry served forever. The board is
 * built by a direct BNet read with no points gate, so it sees the accolade;
 * making it the source of record for the star puts this back to one source per
 * concern. Tier data still merges in because it carries a holder's FULL career
 * of seasons, where the board only tracks their newest.
 */
export function mergeSeasonTitleAwards(
  character: Pick<Character, "name" | "realmSlug">,
  fromTierData: CharacterSeasonTitle[],
  board: SeasonTitleAward[],
): CharacterSeasonTitle[] {
  const mine = board.filter(
    (a) =>
      a.runner.name.toLowerCase() === character.name.toLowerCase() &&
      a.runner.realmSlug.toLowerCase() === character.realmSlug.toLowerCase(),
  );
  if (mine.length === 0) return fromTierData;

  const bySeason = new Map<string, CharacterSeasonTitle>();
  // Tier data first so it wins on a season both sources know: it is the
  // character's own achievement record, and the board carries a `manual`
  // override path the character record does not.
  for (const t of fromTierData) bySeason.set(t.season, t);
  for (const a of mine) {
    if (bySeason.has(a.season)) continue;
    bySeason.set(a.season, {
      title: a.title,
      name: a.name,
      season: a.season,
      earnedAt: a.earnedAt,
      tier: a.tier,
    });
  }
  return [...bySeason.values()].sort((a, b) => b.earnedAt - a.earnedAt);
}
