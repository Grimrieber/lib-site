import { Suspense } from "react";
import { AffixesBanner } from "@/components/AffixesBanner";
import { ClassCompositionDonut } from "@/components/ClassCompositionDonut";
import { Hero } from "@/components/Hero";
import { KeystoneCelebration } from "@/components/KeystoneCelebration";
import { NavReady } from "@/components/NavReady";
import { RecentAchievementsFeed } from "@/components/RecentAchievementsFeed";
import { RecentRunsFeed } from "@/components/RecentRunsFeed";
import { TopPerformers } from "@/components/TopPerformers";
import { WeeklyKeysFeed } from "@/components/WeeklyKeysFeed";
import { IDEAL_MYTHIC_COMP } from "@/lib/config";
import { getGuildSnapshot, getRosterEnrichments } from "@/lib/raiderio";
import { RESILIENT_OVERRIDES } from "@/lib/resilient-overrides";
import type { ResilientAchievement } from "@/lib/types";

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

// Snapshot is served from the bundled `data/snapshot.json`, so the
// Header + Hero render with zero network latency. ISR every 5 min
// regenerates the static shell; Suspense'd enrichments stream in.
export const revalidate = 300;

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
  return (
    <>
      <NavReady />
      <Hero
        tiers={snapshot.tiers}
        weeklyTopRuns={snapshot.weeklyTopRuns}
        recruitingNeeds={recruitingNeeds}
        rankings={snapshot.rankings}
        roster={snapshot.roster}
        topResilient={resilientTop}
      />
      {snapshot.affixes && <AffixesBanner data={snapshot.affixes} />}
      <Suspense fallback={<TopPerformers roster={snapshot.roster} />}>
        <EnrichedTopPerformers />
      </Suspense>
      <ClassCompositionDonut roster={snapshot.roster} />
      <WeeklyKeysFeed
        byCharacter={snapshot.weeklyTopByCharacter ?? []}
        previousByCharacter={snapshot.previousWeekTopByCharacter ?? []}
      />
      {snapshot.recentRuns.length > 0 && (
        <RecentRunsFeed runs={snapshot.recentRuns} />
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
