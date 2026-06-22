import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CharacterTabsClient } from "@/components/character/CharacterTabsClient";
import { ProfileBlock } from "@/components/character/Profile";
import { ScrollToTopOnMount } from "@/components/character/ScrollToTopOnMount";
import { AchievementsTabContent } from "@/components/character/tabs/AchievementsTabContent";
import { CollectionsTabContent } from "@/components/character/tabs/CollectionsTabContent";
import { DungeonsTabContent } from "@/components/character/tabs/DungeonsTabContent";
import { PvpTabContent } from "@/components/character/tabs/PvpTabContent";
import { RaidsTabContent } from "@/components/character/tabs/RaidsTabContent";
import { Skeleton } from "@/components/Skeleton";
import {
  getCharacterBadges,
  getCharacterDetail,
  getGuildSnapshot,
} from "@/lib/raiderio";
import { getStoredCharacterDetail } from "@/lib/character-detail-store";
import { CLASS_LABEL, type Character, type CharacterDetail } from "@/lib/types";

/**
 * Build a minimal CharacterDetail from the snapshot roster summary. Used as the
 * LAST-resort fallback when a roster member has neither a stored detail nor a
 * successful live fetch (a brand-new member in the ~1h before their first seed
 * cycle, or a transient upstream blip). It renders the profile header from data
 * we always have — name, class, ilvl, score — with no live fetch, so a real
 * guild member never sees a 404 ("page never spawned") or a 500. The loadout +
 * tabs are skipped; the next refresh cycle fills in the full detail.
 */
function minimalDetailFromRoster(c: Character): CharacterDetail {
  return {
    name: c.name,
    realm: c.realm,
    realmSlug: c.realmSlug,
    faction: c.faction,
    race: "",
    className: CLASS_LABEL[c.class],
    classKey: c.class,
    spec: c.spec,
    role: c.role,
    ilvl: c.ilvl,
    peakIlvl: c.peakIlvl,
    peakIlvlAt: c.peakIlvlAt,
    mythicPlusScore: c.mythicPlusScore,
    mythicPlusScoreColor: c.mythicPlusScoreColor,
    roleScores: c.roleScores,
    seasonScores: [],
    seasonTitles: [],
    achievementPoints: c.achievementPoints,
    avatarUrl: c.avatarUrl,
    profileUrl: c.profileUrl,
    realmClassRank: c.realmClassRank,
    recentRuns: [],
    bestRuns: [],
    gear: [],
    raidProgression: null,
    stats: null,
    achievements: null,
    tierBadges: null,
    collections: null,
    pvp: null,
    talents: null,
    raidEncounters: null,
  };
}

// Cache each character page as ISR for 1h instead of rendering live on every
// hit. Crawlers hammering ~125 character URLs were the top Vercel Active-CPU
// driver; with all data fetches now 1h-cacheable (RIO profile + BNet
// equipment/achievements/tier), Vercel serves a cached page and only
// regenerates once per hour per character. ilvl/gear/score stay hourly-fresh —
// no meaningful loss vs the underlying armory lag.
export const revalidate = 3600;

// On-demand ISR generation of a never-visited character runs the full live
// BNet/RIO fanout cold (RIO profile + gear + stats + collections + pvp + raid
// encounters). With no maxDuration override that ran against Vercel's short
// default timeout, so a slow cold gen got killed and surfaced as "this page
// couldn't load" — which a refresh (landing on the now-warm data cache) fixed.
// Give the cold path real headroom; warm regenerations finish in well under 1s.
export const maxDuration = 60;

// Empty list = prerender nothing at build (the roster is large and changes
// hourly; build-time prerender of every character would balloon deploys and
// hammer BNet). But exporting generateStaticParams at all opts the route into
// on-demand ISR: the first hit for a character renders + caches for 1h, and
// every subsequent hit (crawlers included) serves the cached page instead of
// re-invoking the heavy BNet fanout. dynamicParams defaults to true.
export async function generateStaticParams() {
  return [];
}

type Props = {
  params: Promise<{ realm: string; name: string }>;
  // children is intentionally unused — all tab content is rendered inline
  // by the layout. The subroute pages exist only as URL aliases that render
  // nothing themselves; their #hash counterpart drives the active tab.
  children?: React.ReactNode;
};

export async function generateMetadata({ params }: Omit<Props, "children">) {
  const { name } = await params;
  return {
    title: `${decodeURIComponent(name)} — Lessons in Brutality`,
  };
}

// Layout body must be synchronous so React can encounter the Suspense
// boundary before any await happens — that's what gets the skeleton
// streamed in the first response chunk (browser switches off old route
// fast). All awaits live inside CharacterContent. The single Suspense
// boundary wraps the whole content, so when getCharacterDetail resolves
// the full page (profile + tabs + tab body) commits as one unit — no
// mid-render swap.
export default function CharacterLayout({ params }: Props) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<CharacterPageSkeleton />}>
        <CharacterContent params={params} />
      </Suspense>
    </div>
  );
}

async function CharacterContent({ params }: { params: Props["params"] }) {
  const { realm, name } = await params;
  const decoded = decodeURIComponent(name);
  const snapshot = await getGuildSnapshot();
  const realmKey = realm.toLowerCase();
  const nameKey = decoded.toLowerCase();
  const rosterEntry = snapshot.roster.find(
    (c) => c.realmSlug.toLowerCase() === realmKey && c.name.toLowerCase() === nameKey,
  );
  // Genuinely not a guild member → 404 is correct.
  if (!rosterEntry) notFound();
  // Read the precomputed detail from Redis (populated by the hourly refresh).
  // This is the reliable path — a few-ms read, no live BNet fanout, so the
  // cold-generation 500 that plagued first views can't happen. Fall back to a
  // live fetch only when a character isn't stored yet (brand-new member, or
  // Redis not configured in local dev). Stored detail already includes talents,
  // so the profile renders them inline instead of streaming them live.
  const stored = await getStoredCharacterDetail(realm, decoded);
  const detailOrLive = stored ?? (await getCharacterDetail(realm, decoded));
  // Last resort: a roster member with neither stored nor live detail renders a
  // minimal header from the snapshot — never a 404/500. The next cycle seeds
  // the full detail.
  const isMinimal = !detailOrLive;
  const detail = detailOrLive ?? minimalDetailFromRoster(rosterEntry);
  // Prestige badges + season-title stars come from the snapshot (computed
  // twice-daily), NOT a live ~2.67MB BNet achievements parse on every render.
  // getCharacterDetail deliberately leaves these empty; we fill them here.
  const detailWithBadges = {
    ...detail,
    ...getCharacterBadges(detail.realmSlug, detail.name),
  };
  // Minimal fallback: render only the header (from snapshot data) + a notice,
  // skipping the loadout/tabs entirely so empty detail can't crash a tab.
  if (isMinimal) {
    return (
      <>
        <ScrollToTopOnMount />
        <ProfileBlock detail={detailWithBadges} />
        <p className="mt-8 rounded-md border border-border bg-surface/40 px-4 py-3 text-sm text-muted">
          Full details for this character are still being fetched — check back
          in a few minutes.
        </p>
      </>
    );
  }
  return (
    <>
      <ScrollToTopOnMount />
      <ProfileBlock detail={detailWithBadges} />
      <div className="mt-8">
        {/* Most tab content is rendered server-side once; CharacterTabsClient
            toggles which is visible (no server roundtrip per click). The
            Achievements tab is the exception — it lazy-loads its summary
            client-side on open, so the heavy achievements blob stays off the
            default render. */}
        <CharacterTabsClient
          raids={<RaidsTabContent detail={detail} />}
          dungeons={<DungeonsTabContent detail={detail} />}
          achievements={
            <AchievementsTabContent
              realmSlug={detail.realmSlug}
              characterName={detail.name}
            />
          }
          collections={<CollectionsTabContent detail={detail} />}
          pvp={<PvpTabContent detail={detail} />}
        />
      </div>
      {detail.profileUrl && (
        <p className="mt-12 text-xs text-muted">
          <a
            href={detail.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            View on Raider.IO ↗
          </a>
        </p>
      )}
    </>
  );
}

function CharacterPageSkeleton() {
  return (
    <>
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <Skeleton className="h-14 w-14 rounded-lg sm:h-16 sm:w-16" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-7 w-48 sm:h-9 sm:w-64" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
            <div className="flex gap-5 sm:ml-auto">
              <Skeleton className="h-6 w-14" />
              <Skeleton className="h-6 w-14" />
              <Skeleton className="h-6 w-14" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <Skeleton className="h-3 w-20" />
          <div className="mt-3 hidden gap-4 lg:grid lg:grid-cols-[1fr_280px_1fr]">
            <div className="space-y-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
            <Skeleton className="h-64 w-full" />
            <div className="space-y-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          </div>
          <div className="mt-3 lg:hidden space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
          <Skeleton className="mt-4 h-40 w-full" />
        </div>
      </section>
      <div className="mt-8 flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>
      <div className="mt-6 space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </>
  );
}
