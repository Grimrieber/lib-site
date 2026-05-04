import { Suspense } from "react";
import { AffixesBanner } from "@/components/AffixesBanner";
import { ClassCompositionDonut } from "@/components/ClassCompositionDonut";
import { Hero } from "@/components/Hero";
import { NavReady } from "@/components/NavReady";
import { RecentAchievementsFeed } from "@/components/RecentAchievementsFeed";
import { RecentRunsFeed } from "@/components/RecentRunsFeed";
import { TopPerformers } from "@/components/TopPerformers";
import { WeeklyKeysFeed } from "@/components/WeeklyKeysFeed";
import { IDEAL_MYTHIC_COMP } from "@/lib/config";
import { getGuildSnapshot, getRosterEnrichments } from "@/lib/raiderio";

// Live data — render at request time. Static-gen would time out trying
// to fetch the full guild snapshot during build (Header in the layout
// fetches it too, so every page is effectively dynamic).
export const dynamic = "force-dynamic";

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
  return (
    <>
      <NavReady />
      <Hero
        tiers={snapshot.tiers}
        weeklyTopRuns={snapshot.weeklyTopRuns}
        recruitingNeeds={recruitingNeeds}
        rankings={snapshot.rankings}
        roster={snapshot.roster}
      />
      {snapshot.affixes && <AffixesBanner data={snapshot.affixes} />}
      <Suspense fallback={<TopPerformers roster={snapshot.roster} />}>
        <EnrichedTopPerformers />
      </Suspense>
      <ClassCompositionDonut roster={snapshot.roster} />
      <WeeklyKeysFeed runs={snapshot.weeklyTopRuns} />
      <Suspense fallback={null}>
        <AchievementsFeed />
      </Suspense>
      {snapshot.recentRuns.length > 0 && (
        <RecentRunsFeed runs={snapshot.recentRuns} />
      )}
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
