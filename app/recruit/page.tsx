import Link from "next/link";
import { CompositionGap } from "@/components/CompositionGap";
import { NavReady } from "@/components/NavReady";
import { GUILD } from "@/lib/config";
import { FACTION_DESCRIPTION } from "@/lib/content";
import { getGuildSnapshot } from "@/lib/raiderio";

export const metadata = {
  title: "Recruit — Lessons in Brutality",
};

// Reads only the bundled snapshot, which changes solely on redeploy. The
// hourly cron commit redeploys and regenerates this page, so static
// prerender stays as fresh as before while serving from the edge with no
// per-request SSR. revalidate is a secondary safety net.
export const revalidate = 3600;

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
        Mythic/Heroic-progression two-night raid team with active Mythic+.
        Looking for sharp players who show up, take notes, and don't tilt.
      </p>

      <section className="mt-10 rounded-md border border-border bg-surface p-6 sm:p-8">
        <h2 className="font-display text-2xl font-semibold">How to apply</h2>
        <p className="mt-3 text-base leading-relaxed text-foreground/90">
          Find us in-game on{" "}
          <span style={{ color: "var(--faction-fg)" }}>
            Lessons in Brutality
          </span>
          {" — "}
          {GUILD.realmDisplay} ({FACTION_DESCRIPTION}). Two ways in:
        </p>
        <ol className="mt-4 space-y-3 text-base leading-relaxed text-foreground/90">
          <li>
            <span
              className="font-display text-sm font-semibold uppercase tracking-widest"
              style={{ color: "var(--faction-fg)" }}
            >
              1. Guild Finder
            </span>
            <span className="ml-2">
              Open Guild &amp; Communities (default <kbd>J</kbd>) → Guild Finder,
              search "Lessons in Brutality", and hit{" "}
              <em>Request to Join</em>. Officers see incoming requests in-game.
            </span>
          </li>
          <li>
            <span
              className="font-display text-sm font-semibold uppercase tracking-widest"
              style={{ color: "var(--faction-fg)" }}
            >
              2. Whisper an officer
            </span>
            <span className="ml-2">
              Whisper or in-game mail any officer directly — listed on the{" "}
              <Link href="/about" className="underline hover:text-foreground">
                About page
              </Link>
              . We respond fast.
            </span>
          </li>
        </ol>
      </section>

      <div className="mt-10">
        <CompositionGap roster={snapshot.roster} />
      </div>
    </div>
  );
}
