import { Suspense } from "react";
import { ClassCompositionDonut } from "@/components/ClassCompositionDonut";
import { FootPoll } from "@/components/FootPoll";
import { Hero } from "@/components/Hero";
import { KeystoneCelebration } from "@/components/KeystoneCelebration";
import { NavReady } from "@/components/NavReady";
import { RecentAchievementsFeed } from "@/components/RecentAchievementsFeed";
import { RecentRunsFeed } from "@/components/RecentRunsFeed";
import {
  SeasonTitleHighlight,
  type SeasonTitleHolder,
} from "@/components/SeasonTitleHighlight";
import { TopPerformers } from "@/components/TopPerformers";
import { WeeklyKeysFeed } from "@/components/WeeklyKeysFeed";
import { isCurrentSeasonTitle, IDEAL_MYTHIC_COMP } from "@/lib/config";
import {
  getGuildSnapshot,
  getRosterEnrichments,
  getRunVideos,
} from "@/lib/raiderio";
import { aggregateSeasonTiers } from "@/lib/season";
import { RESILIENT_OVERRIDES } from "@/lib/resilient-overrides";
import type {
  CharacterWeeklyKeys,
  GuildRun,
  ResilientAchievement,
  WeeklyAffixes,
} from "@/lib/types";

// Apply manual overrides from lib/resilient-overrides.ts at read time so
// edits to that file take effect on the next page reload — no snapshot
// rebuild required. Returns the achievements list with overrides applied
// (earnedAt replaced where set; entries with `hide: true` dropped).
function applyOverrides(
  achievements: ResilientAchievement[],
): ResilientAchievement[] {
  const out: ResilientAchievement[] = [];
  for (const a of achievements) {
    const o = RESILIENT_OVERRIDES[a.runner.name];
    if (!o) {
      out.push(a);
      continue;
    }
    if (o.hide) continue;
    out.push(o.earnedAt ? { ...a, earnedAt: o.earnedAt } : a);
  }
  return out;
}

const RESILIENT_WINDOW_DAYS = 7;
const RESILIENT_TOP_N = 3;
// Modal shows 1 champion (highest tier this week) + up to N most-recent
// other earners under it. Tuned so a 5-person group earning Resilient
// together all surface together in the popup.
const RESILIENT_RECENT_BELOW_MAX = 5;

// Recent earners — those who unlocked their Resilient tier within the last
// 7 days. Sorted so the highest-tier earner (with score as tiebreak) is
// first — that's the "champion" shown in the modal's featured slot.
function findRecentResilient(
  achievements: ResilientAchievement[],
): ResilientAchievement[] {
  const cutoff = Date.now() - RESILIENT_WINDOW_DAYS * 24 * 3600 * 1000;
  return achievements
    .filter((a) => new Date(a.earnedAt).getTime() >= cutoff)
    .sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime();
    });
}

// All-time top-3 Resilient holders. Sort by level desc, RIO score desc for
// tiebreak so a Resilient 19 with a higher score outranks an equal-level
// guildie.
function findTopResilient(
  achievements: ResilientAchievement[],
): ResilientAchievement[] {
  return [...achievements]
    .sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      return b.score - a.score;
    })
    .slice(0, RESILIENT_TOP_N);
}

// Snapshot + enrichments are served from the bundled `data/snapshot.json`,
// so the page renders with zero network latency. The data only changes on
// the hourly redeploy, so revalidate is aligned to 1h — a shorter window
// would just trigger redundant ISR regenerations with no freshness gain.
export const revalidate = 3600;

export default async function Home() {
  const snapshot = await getGuildSnapshot();
  // Compute open spots for the Hero "Recruiting" card. Buckets the active
  // roster by raid-relevant role and subtracts from the configured ideal.
  const counts = { tank: 0, healer: 0, dps: 0 };
  for (const c of snapshot.roster) {
    counts[c.role] += 1;
  }
  const recruitingNeeds = {
    tank: Math.max(0, IDEAL_MYTHIC_COMP.tank - counts.tank),
    healer: Math.max(0, IDEAL_MYTHIC_COMP.healer - counts.healer),
    dps: Math.max(0, IDEAL_MYTHIC_COMP.dps - counts.dps),
  };
  const allResilient = applyOverrides(snapshot.resilient ?? []);
  // Build the popup feed: champion = highest tier this week (level desc,
  // score tiebreak). "Also this week" = the next-most-recent earners (up
  // to N) sorted by earnedAt desc, so a simultaneous group earning shows
  // up together. Champion is excluded from the "below" list to avoid
  // duplication.
  const byChampionOrder = findRecentResilient(allResilient);
  const champion = byChampionOrder[0];
  const restByDate = champion
    ? byChampionOrder
        .filter(
          (a) =>
            !(
              a.runner.name === champion.runner.name &&
              a.earnedAt === champion.earnedAt
            ),
        )
        .sort(
          (a, b) =>
            new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime(),
        )
        .slice(0, RESILIENT_RECENT_BELOW_MAX)
    : [];
  const resilientWinners = champion ? [champion, ...restByDate] : [];
  const resilientTop = findTopResilient(allResilient);

  // Mythic+ seasonal title (top 0.1%) holders, with avatars resolved from the
  // snapshot roster for the home-page marquee. The home board is strictly
  // CURRENT-season (it rolls over each season) — past titles live on the
  // roster as collectible stars, not here. If we can't derive a current-season
  // label, fall back to showing all so a real holder is never hidden.
  const avatarByName = new Map(
    snapshot.roster.map((c) => [c.name, c.avatarUrl]),
  );
  const seasonTitleHolders: SeasonTitleHolder[] = (snapshot.seasonTitles ?? [])
    .filter((t) =>
      isCurrentSeasonTitle(
        t.season,
        snapshot.tierExpansionName,
        snapshot.tierSlug,
      ),
    )
    .map((t) => ({ ...t, avatarUrl: avatarByName.get(t.runner.name) }))
    .sort((a, b) => b.score - a.score);

  return (
    <>
      <NavReady />
      <Hero
        tiers={aggregateSeasonTiers(
          snapshot.tiers,
          snapshot.extraRaids,
          snapshot.tierExpansionName,
        )}
        weeklyTopRuns={snapshot.weeklyTopRuns}
        recruitingNeeds={recruitingNeeds}
        rankings={snapshot.rankings}
        roster={snapshot.roster}
        topResilient={resilientTop}
      />
      <FootPoll />
      <SeasonTitleHighlight holders={seasonTitleHolders} />
      <Suspense fallback={<TopPerformers roster={snapshot.roster} />}>
        <EnrichedTopPerformers />
      </Suspense>
      <ClassCompositionDonut roster={snapshot.roster} />
      <Suspense
        fallback={
          <WeeklyKeysFeed
            byCharacter={snapshot.weeklyTopByCharacter ?? []}
            previousByCharacter={snapshot.previousWeekTopByCharacter ?? []}
            affixes={snapshot.affixes}
          />
        }
      >
        <WeeklyKeysWithVideos
          byCharacter={snapshot.weeklyTopByCharacter ?? []}
          previousByCharacter={snapshot.previousWeekTopByCharacter ?? []}
          affixes={snapshot.affixes}
        />
      </Suspense>
      {snapshot.recentRuns.length > 0 && (
        // Render the feed immediately from the snapshot; stream in the
        // raider.io "Watch" badges (run-details fetch) without blocking.
        <Suspense fallback={<RecentRunsFeed runs={snapshot.recentRuns} />}>
          <RecentRunsWithVideos runs={snapshot.recentRuns} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <AchievementsFeed />
      </Suspense>
      <KeystoneCelebration
        recent={resilientWinners}
        top={resilientTop}
      />
    </>
  );
}

async function EnrichedTopPerformers() {
  const { enrichedRoster } = await getRosterEnrichments();
  return <TopPerformers roster={enrichedRoster} />;
}

async function AchievementsFeed() {
  const { recentAchievements } = await getRosterEnrichments();
  return <RecentAchievementsFeed achievements={recentAchievements} />;
}

async function RecentRunsWithVideos({ runs }: { runs: GuildRun[] }) {
  const videosByUrl = await getRunVideos(runs);
  const enriched =
    videosByUrl.size === 0
      ? runs
      : runs.map((r) =>
          videosByUrl.has(r.url) ? { ...r, videos: videosByUrl.get(r.url) } : r,
        );
  return <RecentRunsFeed runs={enriched} />;
}

async function WeeklyKeysWithVideos({
  byCharacter,
  previousByCharacter,
  affixes,
}: {
  byCharacter: CharacterWeeklyKeys[];
  previousByCharacter: CharacterWeeklyKeys[];
  affixes?: WeeklyAffixes;
}) {
  // Same run-details fetch as RecentRunsWithVideos, but spliced onto the
  // per-character weekly buckets — so a recorded key still surfaces its
  // "Watch" badge here even after others push it off the Latest Runs feed.
  const allRuns = [...byCharacter, ...previousByCharacter].flatMap((e) => e.runs);
  const videosByUrl = await getRunVideos(allRuns);
  const enrich = (entries: CharacterWeeklyKeys[]) =>
    videosByUrl.size === 0
      ? entries
      : entries.map((e) => ({
          ...e,
          runs: e.runs.map((r) =>
            videosByUrl.has(r.url) ? { ...r, videos: videosByUrl.get(r.url) } : r,
          ),
        }));
  return (
    <WeeklyKeysFeed
      byCharacter={enrich(byCharacter)}
      previousByCharacter={enrich(previousByCharacter)}
      affixes={affixes}
    />
  );
}
