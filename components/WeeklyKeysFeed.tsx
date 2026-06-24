import Image from "next/image";
import Link from "next/link";
import { AffixesRow } from "@/components/AffixesBanner";
import { watchUrl } from "@/components/RecentRunsFeed";
import {
  CLASS_COLOR_VAR,
  type CharacterWeeklyKeys,
  type GuildRun,
  type GuildRunner,
  type RunVideo,
  type WeeklyAffixes,
} from "@/lib/types";

export function WeeklyKeysFeed({
  byCharacter,
  previousByCharacter = [],
  affixes,
}: {
  byCharacter: CharacterWeeklyKeys[];
  previousByCharacter?: CharacterWeeklyKeys[];
  affixes?: WeeklyAffixes;
}) {
  // Fall back to last week's bucket when the current cycle hasn't accumulated
  // any runs yet — otherwise this section ghosts itself for the first several
  // hours of every Tuesday reset.
  const showingPrevious = byCharacter.length === 0 && previousByCharacter.length > 0;
  const entries = showingPrevious ? previousByCharacter : byCharacter;
  const hasAffixes = !!affixes && affixes.affixes.length > 0;
  // Render if there are runs to show OR affixes to show — the affixes row
  // should survive a fresh week when no keys have been logged yet.
  if (!entries.length && !hasAffixes) return null;
  return (
    <section className="border-b border-border bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div>
            <h2 className="font-display text-3xl font-semibold">
              {showingPrevious ? "Last Week’s Pushers" : "This Week’s Pushers"}
            </h2>
            <p className="mt-1.5 text-xs text-muted">
              {showingPrevious
                ? "Best 3 keys per pusher · new week rolls in as keys are run"
                : "Best 3 keys per pusher · resets Tuesday 8 AM PT"}
            </p>
          </div>
          {hasAffixes && <AffixesRow data={affixes} />}
        </div>

        {entries.length === 0 ? (
          <p className="mt-6 text-sm text-muted">
            No keys logged yet this week — get pushing.
          </p>
        ) : (
          <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {entries.map((entry, i) => (
              <CharacterCard
                key={`${entry.runner.realmSlug}:${entry.runner.name}`}
                entry={entry}
                place={i + 1}
              />
            ))}
          </ol>
        )}
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
  const { runner, runs } = entry;
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
  // A run sourced from Blizzard's keystone API (the fast lane, before RIO has
  // crawled it) carries a synthetic non-HTTP `bnet:` url — there's no raider.io
  // run page to link to yet. Render it without an anchor; the link appears
  // automatically once RIO catches up and the run gets its real URL.
  const hasRioLink = run.url.startsWith("http");
  const others = run.runners.filter(
    (r) => r.name.toLowerCase() !== cardOwner.name.toLowerCase(),
  );
  // Icon + level + dungeon link out to this run's Raider.IO page for the full
  // breakdown. Kept separate from the co-runner / watch links beside it so we
  // never nest anchors. Falls back to a plain div if a run lacks its RIO url.
  const keyInner = (
    <>
      {run.iconUrl ? (
        <Image
          src={run.iconUrl}
          alt=""
          width={20}
          height={20}
          className="h-5 w-5 shrink-0 rounded-sm"
          unoptimized
        />
      ) : (
        <span className="h-5 w-5 shrink-0 rounded-sm bg-surface" aria-hidden />
      )}
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
    </>
  );
  return (
    <li className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface/40">
      {hasRioLink ? (
        <a
          href={run.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`View +${run.level} ${run.dungeon} on Raider.IO`}
          className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
        >
          {keyInner}
        </a>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">{keyInner}</div>
      )}
      {others.length > 0 ? <CoRunners others={others} /> : null}
      {run.videos && run.videos.length > 0 ? (
        <WatchDot videos={run.videos} />
      ) : null}
      <span className="shrink-0 text-[10px] tabular-nums text-muted">
        {Math.round(run.score)}
      </span>
      <ChestPips chests={chests} />
    </li>
  );
}

function WatchDot({ videos }: { videos: RunVideo[] }) {
  // Compact, icon-only counterpart to RecentRunsFeed's "Watch" badge — the
  // weekly rows are too dense for the full pill. Colour by the first
  // recording's platform (Twitch purple / YouTube red).
  const v = videos[0];
  const isTwitch = v.type === "twitch";
  return (
    <a
      href={watchUrl(v)}
      target="_blank"
      rel="noopener noreferrer"
      title={
        v.characterName
          ? `Watch ${v.characterName}'s run on ${isTwitch ? "Twitch" : "YouTube"}`
          : `Watch on ${isTwitch ? "Twitch" : "YouTube"}`
      }
      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-white transition-opacity hover:opacity-85"
      style={{ backgroundColor: isTwitch ? "#9146FF" : "#FF0000" }}
    >
      <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M8 5v14l11-7z" />
      </svg>
    </a>
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
