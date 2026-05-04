import Link from "next/link";
import { HeroPulsePanel } from "@/components/HeroPulsePanel";
import { GUILD } from "@/lib/config";
import type {
  Character,
  GuildRanking,
  GuildRun,
  TierState,
} from "@/lib/types";

export function Hero({
  tiers,
  weeklyTopRuns,
  recruitingNeeds,
  rankings,
  roster,
}: {
  tiers: TierState[];
  weeklyTopRuns: GuildRun[];
  recruitingNeeds?: { tank: number; healer: number; dps: number };
  rankings: GuildRanking[];
  roster: Character[];
}) {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(ellipse at top, var(--faction-soft) 0%, transparent 60%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
        style={{ background: "var(--faction)" }}
      />

      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:py-32">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <p
              className="font-display text-xs uppercase tracking-[0.4em]"
              style={{ color: "var(--faction-fg)" }}
            >
              {GUILD.realmDisplay} · {GUILD.regionDisplay} · Heroic Raiding
            </p>
            <h1 className="mt-4 font-display text-5xl font-bold leading-[1.05] sm:text-7xl">
              Lessons in
              <br />
              <span style={{ color: "var(--faction-fg)" }}>Brutality</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-muted">
              {GUILD.blurb}
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/recruit"
                className="rounded-md px-6 py-3 font-display text-sm uppercase tracking-widest text-foreground transition-transform hover:scale-105"
                style={{
                  background: "var(--faction)",
                  boxShadow: "0 0 32px var(--faction-soft)",
                }}
              >
                Apply to Raid
              </Link>
              <Link
                href="/progression"
                className="rounded-md border border-border px-6 py-3 font-display text-sm uppercase tracking-widest text-muted transition-colors hover:border-faction hover:text-foreground"
              >
                View Progression
              </Link>
            </div>
          </div>

          <HeroPulsePanel
            tiers={tiers}
            weeklyTopRuns={weeklyTopRuns}
            recruitingNeeds={recruitingNeeds}
            rankings={rankings}
            roster={roster}
          />
        </div>
      </div>
    </section>
  );
}
