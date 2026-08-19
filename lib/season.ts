import type { RaidProgressionGroup, SubRaid, TierState } from "./types";

/**
 * Sum each difficulty's kill counts across the primary tier and every
 * concurrent secondary raid, producing one combined TierState per difficulty —
 * the season-wide "tier progress" total (e.g. MN Tier 1 3/9 + Sporefall 1/1 =
 * 4/10 Mythic). Returns the primary tiers unchanged when there are no extras.
 *
 * A secondary raid only contributes to a difficulty it has *kills* on, so a
 * raid cleared straight on Mythic adds to the Mythic total but doesn't inflate
 * the Heroic total with an un-killed boss (mirrors the per-board "hide empty
 * difficulties" behaviour). The primary tier always counts.
 *
 * `seasonName` overrides the combined raidName — the count spans multiple
 * raids, so the primary raid's name alone would be misleading; pass the
 * expansion/season label. Bosses + killedSlugs are concatenated so downstream
 * "next progging" logic still resolves the first un-killed boss across the
 * whole season.
 */
export function aggregateSeasonTiers(
  tiers: TierState[],
  extraRaids: RaidProgressionGroup[] | undefined,
  seasonName?: string,
): TierState[] {
  if (!extraRaids || extraRaids.length === 0) return tiers;
  return tiers.map((t) => {
    const extras = extraRaids
      .map((g) => g.tiers.find((et) => et.difficulty === t.difficulty))
      .filter((et): et is TierState => et != null && et.killed > 0);
    if (extras.length === 0) return t;
    const killed = t.killed + extras.reduce((s, et) => s + et.killed, 0);
    const totalBosses =
      t.totalBosses + extras.reduce((s, et) => s + et.totalBosses, 0);
    const bosses = [...t.bosses, ...extras.flatMap((et) => et.bosses)];
    const killedSlugs =
      t.killedSlugs != null
        ? [...t.killedSlugs, ...extras.flatMap((et) => et.killedSlugs ?? [])]
        : undefined;
    // Keep a per-raid breakdown alongside the concatenated boss list. The
    // aggregate spans several raids, so "first un-killed boss" alone can't tell
    // whether the guild is progging a raid or hasn't set foot in it yet — at a
    // tier rollover the newest raid sorts first and contributes boss #1 while
    // the non-zero kill count comes entirely from raids already cleared.
    // Callers use these segments to attribute `next` to its own raid.
    const primarySegments: SubRaid[] = t.subRaids?.length
      ? t.subRaids
      : [
          {
            name: t.raidName,
            bosses: t.bosses,
            killed: t.killed,
            killedSlugs: t.killedSlugs,
          },
        ];
    const extraSegments: SubRaid[] = extras.map((et) => ({
      name: et.raidName,
      bosses: et.bosses,
      killed: et.killed,
      killedSlugs: et.killedSlugs,
    }));
    return {
      ...t,
      raidName: seasonName ?? t.raidName,
      killed,
      totalBosses,
      bosses,
      killedSlugs,
      subRaids: [...primarySegments, ...extraSegments],
    };
  });
}
