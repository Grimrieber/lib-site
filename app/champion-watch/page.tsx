import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGuildSnapshot, getRosterEnrichments } from "@/lib/raiderio";
import { SeasonEndWatch, getSeasonWatch } from "@/components/SeasonEndWatch";

/**
 * LOCAL-ONLY standalone view of the Season-End Watch demo (the same component
 * that renders dev-only under Top Performers on the home page). noindex +
 * dev-only — never reachable in production.
 */
export const metadata: Metadata = {
  title: "Season-End Watch (demo)",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function SeasonWatchPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const [{ enrichedRoster }, snapshot] = await Promise.all([
    getRosterEnrichments(),
    getGuildSnapshot(),
  ]);
  const watch = await getSeasonWatch(
    enrichedRoster,
    snapshot.seasonContext?.currentSeasonSlug ??
      snapshot.currentSeasonSlug ??
      (snapshot.tierSlug?.startsWith("tier-")
        ? snapshot.tierSlug.replace(/^tier-/, "season-")
        : undefined),
    snapshot.seasonContext?.currentSeasonStartsAt,
  );
  return (
    <div className="py-6">
      {watch ? (
        <SeasonEndWatch watch={watch} />
      ) : (
        <p className="mx-auto max-w-2xl px-4 py-12 text-sm italic text-muted">
          Raider.IO cutoffs unavailable right now — refresh to retry.
        </p>
      )}
    </div>
  );
}
