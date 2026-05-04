import { CompositionGap } from "@/components/CompositionGap";
import { NavReady } from "@/components/NavReady";
import { RecruitForm } from "@/components/RecruitForm";
import { getGuildSnapshot } from "@/lib/raiderio";

export const metadata = {
  title: "Recruit — Lessons in Brutality",
};

export default async function RecruitPage() {
  const snapshot = await getGuildSnapshot();
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <NavReady />
      <p
        className="font-display text-xs uppercase tracking-[0.4em]"
        style={{ color: "var(--faction-fg)" }}
      >
        Join the Roster
      </p>
      <h1 className="mt-2 font-display text-5xl font-bold">Recruitment</h1>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-muted">
        Heroic-progression two-night raid team with active Mythic+. Looking for
        sharp players who show up, take notes, and don't tilt.
      </p>

      <div className="mt-8">
        <CompositionGap roster={snapshot.roster} />
      </div>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-semibold">Application</h2>
        <p className="mt-2 text-sm text-muted">
          Required fields are marked. Be specific about prog — vague apps get
          skipped.
        </p>
        <div className="mt-6">
          <RecruitForm />
        </div>
      </section>
    </div>
  );
}
