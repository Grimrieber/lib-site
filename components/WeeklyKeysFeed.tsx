import Image from "next/image";
import Link from "next/link";
import {
  CLASS_COLOR_VAR,
  type CharacterWeeklyKeys,
  type GuildRun,
  type GuildRunner,
} from "@/lib/types";

export function WeeklyKeysFeed({
  byCharacter,
}: {
  byCharacter: CharacterWeeklyKeys[];
}) {
  if (!byCharacter.length) return null;
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
              This Week&apos;s Pushers
            </h2>
          </div>
          <p className="text-xs text-muted">
            Best 3 keys per pusher · resets Tuesday 8 AM PT
          </p>
        </div>

        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {byCharacter.map((entry, i) => (
            <CharacterCard
              key={`${entry.runner.realmSlug}:${entry.runner.name}`}
              entry={entry}
              place={i + 1}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}

function CharacterCard({
  entry,
  place,
}: {
  entry: CharacterWeeklyKeys;
  place: number;
}) {
  const { runner, runs, topScore } = entry;
  const classColor = CLASS_COLOR_VAR[runner.class];
  const isPodium = place <= 3;
  return (
    <li
      className="group relative overflow-hidden rounded-md border border-border bg-background/80 transition-colors hover:border-border/80"
      style={
        isPodium
          ? { boxShadow: "inset 0 1px 0 0 var(--faction-fg)" }
          : undefined
      }
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: classColor }}
      />
      <div className="flex flex-col gap-1.5 pl-3 pr-2.5 py-2.5">
        <div className="flex items-baseline gap-2">
          <span
            className="font-display text-sm font-semibold leading-none tabular-nums"
            style={{
              color: isPodium ? "var(--faction-fg)" : "var(--color-muted)",
              opacity: isPodium ? 1 : 0.6,
            }}
          >
            {place}
          </span>
          <Link
            href={`/character/${runner.realmSlug}/${encodeURIComponent(runner.name)}`}
            className="min-w-0 flex-1 truncate font-display text-sm font-semibold tracking-wide hover:underline"
            style={{ color: classColor }}
          >
            {runner.name}
          </Link>
          <span
            className="shrink-0 font-display text-sm font-semibold tabular-nums"
            style={{ color: "var(--faction-fg)" }}
          >
            {Math.round(topScore)}
          </span>
        </div>
        <ul className="flex flex-col gap-0.5">
          {runs.map((run) => (
            <RunRow key={run.url} run={run} cardOwner={runner} />
          ))}
        </ul>
      </div>
    </li>
  );
}

function RunRow({
  run,
  cardOwner,
}: {
  run: GuildRun;
  cardOwner: GuildRunner;
}) {
  const inTime = run.upgrades > 0;
  const chests = inTime ? run.upgrades + 1 : 0;
  const others = run.runners.filter(
    (r) => r.name.toLowerCase() !== cardOwner.name.toLowerCase(),
  );
  return (
    <li className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface/40">
      <Image
        src={run.iconUrl}
        alt=""
        width={20}
        height={20}
        className="h-5 w-5 shrink-0 rounded-sm"
        unoptimized
      />
      <span
        className="shrink-0 font-display text-sm font-semibold leading-none tabular-nums"
        style={{
          color: inTime ? "var(--faction-fg)" : "var(--color-muted)",
        }}
      >
        +{run.level}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
        {run.dungeon}
      </span>
      {others.length > 0 ? <CoRunners others={others} /> : null}
      <span className="shrink-0 text-[10px] tabular-nums text-muted">
        {Math.round(run.score)}
      </span>
      <ChestPips chests={chests} />
    </li>
  );
}

function CoRunners({ others }: { others: GuildRunner[] }) {
  const MAX = 2;
  const visible = others.slice(0, MAX);
  const overflow = others.length - visible.length;
  const allNames = others.map((r) => r.name).join(", ");
  return (
    <div
      className="flex shrink-0 items-center gap-[3px]"
      title={`with ${allNames}`}
    >
      {visible.map((r) => (
        <Link
          key={r.name}
          href={`/character/${r.realmSlug}/${encodeURIComponent(r.name)}`}
          className="flex h-3.5 min-w-3.5 items-center justify-center rounded-sm px-[3px] font-display text-[9px] font-semibold uppercase leading-none"
          style={{
            color: CLASS_COLOR_VAR[r.class],
            borderColor: CLASS_COLOR_VAR[r.class],
            borderWidth: 1,
            backgroundColor: `color-mix(in srgb, ${CLASS_COLOR_VAR[r.class]} 14%, transparent)`,
          }}
        >
          {r.name.slice(0, 1)}
        </Link>
      ))}
      {overflow > 0 ? (
        <span
          className="flex h-3.5 items-center justify-center rounded-sm border border-border/60 px-[3px] text-[9px] font-semibold leading-none text-muted"
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

function ChestPips({ chests }: { chests: number }) {
  if (chests === 0) {
    return (
      <span className="shrink-0 text-[9px] uppercase tracking-wider text-muted">
        dep
      </span>
    );
  }
  return (
    <div
      className="flex shrink-0 items-center gap-[2px]"
      aria-label={`${chests} chest${chests > 1 ? "s" : ""}`}
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <span
          key={i}
          className="h-1 w-1 rounded-full"
          style={{
            backgroundColor:
              i < chests
                ? "var(--faction-fg)"
                : "color-mix(in srgb, var(--color-border) 70%, transparent)",
          }}
        />
      ))}
    </div>
  );
}
