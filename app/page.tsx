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
import type { GuildRun } from "@/lib/types";

const RESILIENT_LEVEL = 19;
const RESILIENT_WINDOW_DAYS = 7;

// Filter recent runs for "Resilient" (+19 or higher, timed) within the last
// 7 days. Dedupe by primary runner — one celebration per character, keeping
// their highest-level run (ties broken by most recent).
function findResilientWinners(runs: GuildRun[]): GuildRun[] {
  const cutoff = Date.now() - RESILIENT_WINDOW_DAYS * 24 * 3600 * 1000;
  const byCharacter = new Map<string, GuildRun>();
  for (const run of runs) {
    if (run.level < RESILIENT_LEVEL || run.upgrades < 1) continue;
    const completed = new Date(run.completedAt).getTime();
    if (completed < cutoff) continue;
    const name = run.runners[0]?.name;
    if (!name) continue;
    const existing = byCharacter.get(name);
    if (
      !existing ||
      run.level > existing.level ||
      (run.level === existing.level &&
        completed > new Date(existing.completedAt).getTime())
    ) {
      byCharacter.set(name, run);
    }
  }
  return [...byCharacter.values()].sort(
    (a, b) =>
      new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
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
  const resilientWinners = findResilientWinners(snapshot.recentRuns);
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
      <KeystoneCelebration runs={resilientWinners} />
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
