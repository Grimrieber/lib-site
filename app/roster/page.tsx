import { Suspense } from "react";
import { ClassComposition } from "@/components/ClassComposition";
import { NavReady } from "@/components/NavReady";
import { RosterGrid } from "@/components/RosterGrid";
import { getGuildSnapshot, getRosterEnrichments } from "@/lib/raiderio";

export const metadata = {
  title: "Roster — Lessons in Brutality",
};

export default async function RosterPage() {
  const snapshot = await getGuildSnapshot();
  const isLive = snapshot.source === "raiderio";

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <NavReady />
      <p
        className="font-display text-xs uppercase tracking-[0.4em]"
        style={{ color: "var(--faction-fg)" }}
      >
        The Raiders
      </p>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-5xl font-bold">Roster</h1>
        <p className="text-xs uppercase tracking-widest text-muted">
          {isLive ? "Live · Raider.IO" : "Mock data (Raider.IO unavailable)"}
        </p>
      </div>
      <p className="mt-3 max-w-2xl text-muted">
        Active raiders matching the guild's current progression. Guild
        leaders pinned at top, then sorted by Mythic+ score. Class-colored
        as you'd expect; the faction stripe on each card is the character's
        own faction.
      </p>

      <div className="mt-8">
        <ClassComposition roster={snapshot.roster} />
      </div>

      <div className="mt-8">
        <Suspense fallback={<RosterGrid roster={snapshot.roster} />}>
          <EnrichedRoster />
        </Suspense>
      </div>
    </section>
  );
}

async function EnrichedRoster() {
  const { enrichedRoster } = await getRosterEnrichments();
  return <RosterGrid roster={enrichedRoster} />;
}
