import Image from "next/image";
import Link from "next/link";
import { CLASS_COLOR_VAR, type GuildRun } from "@/lib/types";

export function WeeklyKeysFeed({ runs }: { runs: GuildRun[] }) {
  if (!runs.length) return null;
  return (
    <section className="border-b border-border bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p
              className="font-display text-xs uppercase tracking-[0.4em]"
              style={{ color: "var(--faction-fg)" }}
            >
              This Week
            </p>
            <h2 className="mt-2 font-display text-3xl font-semibold">
              Top Keys Since Reset
            </h2>
          </div>
          <p className="text-xs text-muted">
            Sorted by score · resets Tuesday 8 AM PT
          </p>
        </div>

        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {runs.map((r, i) => (
            <KeyRow key={r.url} run={r} place={i + 1} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function KeyRow({ run, place }: { run: GuildRun; place: number }) {
  const inTime = run.upgrades > 0;
  const chestLabel = inTime ? "+".repeat(run.upgrades + 1) : "Depleted";
  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-background p-3">
      <span className="w-5 shrink-0 font-display text-sm tabular-nums text-muted">
        {place}
      </span>
      <Image
        src={run.iconUrl}
        alt=""
        width={44}
        height={44}
        className="h-11 w-11 shrink-0 rounded"
      unoptimized
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="font-display text-sm font-semibold leading-tight">
            {run.runners.map((r, i) => (
              <span key={r.name}>
                <Link
                  href={`/character/${r.realmSlug}/${encodeURIComponent(r.name)}`}
                  className="hover:underline"
                  style={{ color: CLASS_COLOR_VAR[r.class] }}
                >
                  {r.name}
                </Link>
                {i < run.runners.length - 1 ? (
                  <span className="text-muted">, </span>
                ) : null}
              </span>
            ))}
          </p>
          <span
            className="ml-auto shrink-0 font-display text-xs"
            style={{
              color: inTime ? "var(--faction-fg)" : "var(--color-muted)",
            }}
          >
            {chestLabel}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-foreground/80">
          +{run.level} {run.dungeon}
        </p>
        <p className="text-[10px] uppercase tracking-widest text-muted">
          {Math.round(run.score)} pts
        </p>
      </div>
    </li>
  );
}
