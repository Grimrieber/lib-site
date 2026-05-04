import Image from "next/image";
import type {
  CharacterDetail,
  MythicPlusRun,
  SeasonScore,
} from "@/lib/types";

export function DungeonsTabContent({ detail }: { detail: CharacterDetail }) {
  const noData =
    detail.bestRuns.length === 0 &&
    detail.recentRuns.length === 0 &&
    detail.seasonScores.length === 0;
  if (noData) {
    return <p className="text-muted">No Mythic+ history.</p>;
  }

  const [currentSeason, ...pastSeasons] = detail.seasonScores;

  return (
    <div className="space-y-10">
      {currentSeason && (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl font-semibold">
              Current Season
            </h2>
            <p className="font-display text-xs uppercase tracking-widest text-muted">
              {currentSeason.label}
            </p>
          </div>
          <div className="mt-3">
            <SeasonScoreCard season={currentSeason} prominent />
          </div>
        </section>
      )}

      {detail.bestRuns.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Best Keys (Per Dungeon)
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...detail.bestRuns]
              .sort((a, b) => b.score - a.score)
              .map((r) => (
                <RunCard key={`${r.shortName}-${r.completedAt}`} run={r} />
              ))}
          </div>
        </section>
      )}

      {detail.recentRuns.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-semibold">Recent Runs</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {detail.recentRuns.map((r) => (
              <RunCard key={`${r.shortName}-${r.completedAt}`} run={r} />
            ))}
          </div>
        </section>
      )}

      {pastSeasons.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Season History
          </h2>
          <p className="mt-1 text-xs text-muted">
            Total Mythic+ score per season this character logged keys in.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pastSeasons.map((s) => (
              <SeasonScoreCard key={s.slug} season={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SeasonScoreCard({
  season,
  prominent,
}: {
  season: SeasonScore;
  prominent?: boolean;
}) {
  const color = season.color ?? "var(--color-muted)";
  return (
    <div
      className="rounded-md border border-border bg-surface p-3"
      style={prominent ? { borderColor: season.color } : undefined}
    >
      <p className="font-display text-[10px] uppercase tracking-widest text-muted">
        {season.label}
      </p>
      <p
        className={`mt-1 font-display tabular-nums ${prominent ? "text-3xl" : "text-xl"} font-bold`}
        style={{ color }}
      >
        {Math.round(season.score).toLocaleString()}
      </p>
    </div>
  );
}

function RunCard({ run }: { run: MythicPlusRun }) {
  const inTime = run.upgrades > 0;
  const chestLabel = inTime ? "+".repeat(run.upgrades + 1) : "Depleted";
  const completed = new Date(run.completedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const m = Math.floor(run.clearTimeMs / 60_000);
  const s = Math.floor((run.clearTimeMs % 60_000) / 1000);
  const time = `${m}:${s.toString().padStart(2, "0")}`;
  const overUnder = (run.clearTimeMs - run.parTimeMs) / 1000;

  return (
    <a
      href={run.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-3 rounded-md border border-border bg-surface p-3 transition-colors hover:border-faction"
    >
      <Image
        src={run.iconUrl}
        alt=""
        width={48}
        height={48}
        unoptimized
        className="h-12 w-12 shrink-0 rounded"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate font-display text-sm font-semibold">
            +{run.level} {run.dungeon}
          </p>
          <span
            className="shrink-0 font-display text-xs"
            style={{ color: inTime ? "var(--faction-fg)" : "var(--color-muted)" }}
          >
            {chestLabel}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted">
          <span>{Math.round(run.score)} pts</span>
          <span>·</span>
          <span>{time}</span>
          <span
            className={
              overUnder <= 0 ? "text-foreground/80" : "text-foreground/40"
            }
          >
            ({overUnder <= 0 ? "−" : "+"}
            {Math.abs(overUnder).toFixed(0)}s)
          </span>
        </div>
        <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted/70">
          {completed}
        </p>
      </div>
    </a>
  );
}
