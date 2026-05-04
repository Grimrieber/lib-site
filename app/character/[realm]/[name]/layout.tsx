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
import { getCharacterDetail } from "@/lib/raiderio";

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
  const detail = await getCharacterDetail(realm, decoded);
  if (!detail) notFound();
  return (
    <>
      <ScrollToTopOnMount />
      <ProfileBlock detail={detail} />
      <div className="mt-8">
        {/* All tab content rendered server-side once. CharacterTabsClient
            (a client component) toggles which is visible based on URL hash.
            No server roundtrip per tab click. */}
        <CharacterTabsClient
          raids={<RaidsTabContent detail={detail} />}
          dungeons={<DungeonsTabContent detail={detail} />}
          achievements={<AchievementsTabContent detail={detail} />}
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
