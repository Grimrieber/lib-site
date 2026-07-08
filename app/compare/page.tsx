import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { NavReady } from "@/components/NavReady";
import { ComparePicker } from "@/components/ComparePicker";
import { Skeleton } from "@/components/Skeleton";
import { GUILD } from "@/lib/config";
import { getCharacterDetail, getGuildSnapshot } from "@/lib/raiderio";
import { getStoredCharacterDetail } from "@/lib/character-detail-store";
import { withFreshRosterCore } from "@/lib/roster-derive";
import {
  CLASS_COLOR_VAR,
  CLASS_LABEL,
  type CharacterDetail,
  type MythicPlusRun,
} from "@/lib/types";

type Props = {
  searchParams: Promise<{ a?: string; b?: string }>;
};

export const metadata = {
  title: "Compare Characters — Lessons in Brutality",
};

export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: Props) {
  const sp = await searchParams;
  const aName = sp.a?.trim();
  const bName = sp.b?.trim();

  const snapshot = await getGuildSnapshot();
  const rosterEntries = snapshot.roster.map((c) => ({
    name: c.name,
    realmSlug: c.realmSlug,
    class: c.class,
    spec: c.spec,
  }));

  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <NavReady />
      <p
        className="font-display text-xs uppercase tracking-[0.4em]"
        style={{ color: "var(--faction-fg)" }}
      >
        Side by Side
      </p>
      <h1 className="mt-2 font-display text-5xl font-bold">Compare</h1>
      <p className="mt-3 text-muted">
        Pick two LIB guild mates to compare gear level, M+ score, ranks, and
        progression.
      </p>

      <div className="mt-8">
        <ComparePicker
          roster={rosterEntries}
          initialA={aName ?? ""}
          initialB={bName ?? ""}
        />
      </div>

      {(aName || bName) && (
        <Suspense
          // Suspense key forces a fresh fallback whenever the picked
          // characters change, instead of showing stale data while the new
          // pair loads.
          key={`${aName ?? ""}|${bName ?? ""}`}
          fallback={<CompareSkeleton aName={aName} bName={bName} />}
        >
          <CompareLoader
            aName={aName}
            bName={bName}
            roster={snapshot.roster}
          />
        </Suspense>
      )}
    </section>
  );
}

async function CompareLoader({
  aName,
  bName,
  roster,
}: {
  aName?: string;
  bName?: string;
  roster: import("@/lib/types").Character[];
}) {
  function realmFor(name?: string): string {
    if (!name) return GUILD.realm;
    const match = roster.find(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
    return match?.realmSlug ?? GUILD.realm;
  }
  // Read the same precomputed detail the character page uses (hourly, from
  // Redis) so compare shows the SAME numbers as the roster / character pages
  // instead of a divergent live per-request fetch. Falls back to a live fetch
  // only when a character isn't stored yet (same pattern as the character page).
  async function loadDetail(name?: string): Promise<CharacterDetail | null> {
    if (!name) return null;
    const realm = realmFor(name);
    const detail =
      (await getStoredCharacterDetail(realm, name)) ??
      (await getCharacterDetail(realm, name).catch(() => null));
    if (!detail) return null;
    // Overlay the fresh snapshot-roster core scores (same shared helper the
    // character page uses) so the "M+ Score" / "Achievement Points" rows match
    // the leaderboard instead of showing the stale precompute value — this was
    // the long-standing "leaderboard vs compare score gap". Per-dungeon best
    // keys (DungeonBreakdown) have no snapshot source, so they ride the detail
    // precompute's own refresh gate.
    const rosterChar = roster.find(
      (c) =>
        c.name.toLowerCase() === name.toLowerCase() &&
        c.realmSlug.toLowerCase() === realm.toLowerCase(),
    );
    return withFreshRosterCore(detail, rosterChar);
  }
  const [a, b] = await Promise.all([loadDetail(aName), loadDetail(bName)]);
  if (a && b) {
    return (
      <div className="mt-10">
        <SideBySide a={a} b={b} />
      </div>
    );
  }
  return (
    <p className="mt-10 text-muted">
      {aName && !a ? `Couldn't load "${aName}". ` : null}
      {bName && !b ? `Couldn't load "${bName}". ` : null}
      {!aName || !bName ? "Pick two characters above." : null}
    </p>
  );
}

function CompareSkeleton({
  aName,
  bName,
}: {
  aName?: string;
  bName?: string;
}) {
  return (
    <div className="mt-10">
      <p className="mb-4 font-display text-xs uppercase tracking-widest text-muted">
        Loading {aName && bName ? `${aName} vs ${bName}` : aName || bName}…
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-surface p-5"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-14 w-14 rounded-lg" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-7 w-40" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          </div>
        ))}
        <div className="md:col-span-2 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border py-3 last:border-b-0"
            >
              <div className="flex justify-end">
                <Skeleton className="h-7 w-20" />
              </div>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SideBySide({ a, b }: { a: CharacterDetail; b: CharacterDetail }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <CharacterColumn detail={a} />
      <CharacterColumn detail={b} />

      <div className="md:col-span-2">
        <DiffRow
          label="ilvl"
          aValue={a.peakIlvl ?? a.ilvl ?? 0}
          bValue={b.peakIlvl ?? b.ilvl ?? 0}
          format={(v) => String(parseFloat(v.toFixed(3)))}
        />
        {a.stats && b.stats && (
          <>
            <DiffRow
              label="Health"
              aValue={a.stats.health}
              bValue={b.stats.health}
              format={(v) => v.toLocaleString()}
            />
            <DiffRow
              label={
                a.stats.primaryStatLabel === b.stats.primaryStatLabel
                  ? a.stats.primaryStatLabel
                  : "Primary Stat"
              }
              aValue={a.stats.primaryStatValue}
              bValue={b.stats.primaryStatValue}
              format={(v) => v.toLocaleString()}
            />
            <DiffRow
              label="Stamina"
              aValue={a.stats.stamina}
              bValue={b.stats.stamina}
              format={(v) => v.toLocaleString()}
            />
            <DiffRow
              label="Crit"
              aValue={a.stats.crit}
              bValue={b.stats.crit}
              format={(v) => `${v.toFixed(2)}%`}
            />
            <DiffRow
              label="Haste"
              aValue={a.stats.haste}
              bValue={b.stats.haste}
              format={(v) => `${v.toFixed(2)}%`}
            />
            <DiffRow
              label="Mastery"
              aValue={a.stats.mastery}
              bValue={b.stats.mastery}
              format={(v) => `${v.toFixed(2)}%`}
            />
            <DiffRow
              label="Versatility"
              aValue={a.stats.versatility}
              bValue={b.stats.versatility}
              format={(v) => `${v.toFixed(2)}%`}
            />
          </>
        )}
        <DiffRow
          label="M+ Score"
          aValue={a.mythicPlusScore ?? 0}
          bValue={b.mythicPlusScore ?? 0}
          format={(v) => Math.round(v).toLocaleString()}
        />
        <DiffRow
          label="Achievement Points"
          aValue={a.achievementPoints ?? 0}
          bValue={b.achievementPoints ?? 0}
          format={(v) => v.toLocaleString()}
        />
        {a.raidProgression && b.raidProgression && (
          <>
            <DiffRow
              label="Heroic Kills"
              aValue={a.raidProgression.heroicKilled}
              bValue={b.raidProgression.heroicKilled}
              format={(v) =>
                `${v}/${
                  a.raidProgression?.heroicTotal ??
                  a.raidProgression?.totalBosses ??
                  "—"
                }`
              }
            />
            <DiffRow
              label="Mythic Kills"
              aValue={a.raidProgression.mythicKilled}
              bValue={b.raidProgression.mythicKilled}
              format={(v) =>
                `${v}/${
                  a.raidProgression?.mythicTotal ??
                  a.raidProgression?.totalBosses ??
                  "—"
                }`
              }
            />
          </>
        )}
        <DiffRow
          label="Mounts"
          aValue={a.collections?.mountCount ?? 0}
          bValue={b.collections?.mountCount ?? 0}
          format={(v) => v.toLocaleString()}
        />
        <DiffRow
          label="Pets"
          aValue={a.collections?.petCount ?? 0}
          bValue={b.collections?.petCount ?? 0}
          format={(v) => v.toLocaleString()}
        />
        <DiffRow
          label="Honor Level"
          aValue={a.pvp?.honorLevel ?? 0}
          bValue={b.pvp?.honorLevel ?? 0}
          format={(v) => v.toLocaleString()}
        />
      </div>

      <DungeonBreakdown a={a} b={b} />
    </div>
  );
}

/**
 * Per-dungeon Mythic+ comparison. Uses each character's `bestRuns` (RIO's
 * best timed key per active-season dungeon), so for every dungeon either
 * raider has run we show their key level + run score side by side and
 * highlight the higher score. A "Dungeons Timed" summary row counts how
 * many of the season's dungeons each has a best run for.
 */
function DungeonBreakdown({
  a,
  b,
}: {
  a: CharacterDetail;
  b: CharacterDetail;
}) {
  const byDungeon = (runs: MythicPlusRun[]): Map<string, MythicPlusRun> => {
    const m = new Map<string, MythicPlusRun>();
    for (const r of runs) {
      const prev = m.get(r.dungeon);
      // bestRuns is already one-per-dungeon, but guard against dupes by
      // keeping the higher-scored entry.
      if (!prev || r.score > prev.score) m.set(r.dungeon, r);
    }
    return m;
  };
  const aRuns = byDungeon(a.bestRuns ?? []);
  const bRuns = byDungeon(b.bestRuns ?? []);

  // Union of dungeon names, with a stable icon per dungeon (whichever side
  // has a run). Sort by best combined score desc so the marquee keys lead.
  const names = Array.from(new Set([...aRuns.keys(), ...bRuns.keys()]));
  if (names.length === 0) return null;
  const rows = names
    .map((dungeon) => {
      const ar = aRuns.get(dungeon);
      const br = bRuns.get(dungeon);
      return {
        dungeon,
        shortName: ar?.shortName ?? br?.shortName ?? dungeon,
        iconUrl: ar?.iconUrl ?? br?.iconUrl,
        ar,
        br,
      };
    })
    .sort(
      (x, y) =>
        Math.max(y.ar?.score ?? 0, y.br?.score ?? 0) -
        Math.max(x.ar?.score ?? 0, x.br?.score ?? 0),
    );

  return (
    <div className="md:col-span-2 mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xs uppercase tracking-[0.3em] text-muted">
          Mythic+ Dungeons
        </h3>
        <p className="font-display text-[10px] uppercase tracking-widest text-muted">
          {aRuns.size} vs {bRuns.size} timed
        </p>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
        {rows.map((row, i) => (
          <DungeonRow
            key={row.dungeon}
            row={row}
            className={i > 0 ? "border-t border-border" : ""}
          />
        ))}
      </div>
    </div>
  );
}

function DungeonRow({
  row,
  className = "",
}: {
  row: {
    dungeon: string;
    shortName: string;
    iconUrl?: string;
    ar?: MythicPlusRun;
    br?: MythicPlusRun;
  };
  className?: string;
}) {
  const aScore = row.ar?.score ?? 0;
  const bScore = row.br?.score ?? 0;
  const aWins = aScore > bScore;
  const bWins = bScore > aScore;
  return (
    <div
      className={`grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2.5 ${className}`}
    >
      <DungeonCell run={row.ar} win={aWins} lose={bWins} align="right" />
      <div className="flex flex-col items-center gap-1">
        {row.iconUrl && (
          <Image
            src={row.iconUrl}
            alt=""
            width={28}
            height={28}
            unoptimized
            className="h-7 w-7 rounded"
          />
        )}
        <span className="font-display text-[10px] uppercase tracking-widest text-muted">
          {row.shortName}
        </span>
      </div>
      <DungeonCell run={row.br} win={bWins} lose={aWins} align="left" />
    </div>
  );
}

function DungeonCell({
  run,
  win,
  lose,
  align,
}: {
  run?: MythicPlusRun;
  win: boolean;
  lose: boolean;
  align: "left" | "right";
}) {
  const alignClass = align === "right" ? "text-right items-end" : "text-left items-start";
  if (!run) {
    return (
      <div className={`flex flex-col ${alignClass}`}>
        <span className="font-display text-lg font-semibold text-muted/40">—</span>
      </div>
    );
  }
  const timed = run.upgrades > 0;
  return (
    <div className={`flex flex-col ${alignClass}`}>
      <span
        className="font-display text-lg font-semibold tabular-nums sm:text-xl"
        style={{
          color: win ? "var(--faction-fg)" : undefined,
          opacity: lose ? 0.55 : 1,
        }}
      >
        +{run.level}
        {!timed && (
          <span className="ml-1 align-middle text-[10px] uppercase tracking-wide text-muted">
            depl
          </span>
        )}
      </span>
      <span
        className="text-xs tabular-nums text-muted"
        style={{ opacity: lose ? 0.55 : 1 }}
      >
        {Math.round(run.score)} pts
      </span>
    </div>
  );
}

function CharacterColumn({ detail }: { detail: CharacterDetail }) {
  const classColor = CLASS_COLOR_VAR[detail.classKey];
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        {detail.avatarUrl && (
          <div
            className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg"
            style={{ border: `2px solid ${classColor}` }}
          >
            <Image
              src={detail.avatarUrl}
              alt={detail.name}
              fill
              sizes="56px"
              unoptimized
              className="object-cover"
            />
          </div>
        )}
        <div className="min-w-0">
          <h2
            className="truncate font-display text-2xl font-bold leading-tight"
            style={{ color: classColor }}
          >
            <Link
              href={`/character/${detail.realmSlug}/${encodeURIComponent(detail.name)}`}
              className="hover:underline"
            >
              {detail.name}
            </Link>
          </h2>
          <p className="text-xs text-muted">
            {detail.race} · {detail.spec} {CLASS_LABEL[detail.classKey]}
          </p>
        </div>
      </div>
    </div>
  );
}

function DiffRow({
  label,
  aValue,
  bValue,
  format,
}: {
  label: string;
  aValue: number;
  bValue: number;
  format: (v: number) => string;
}) {
  const aWins = aValue > bValue;
  const bWins = bValue > aValue;
  const tied = aValue === bValue;
  const fadedClass =
    "font-display text-xl font-semibold tabular-nums sm:text-2xl";
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border py-3 last:border-b-0">
      <p
        className={`text-right ${fadedClass}`}
        style={{
          color: tied
            ? undefined
            : aWins
              ? "var(--faction-fg)"
              : "rgb(var(--color-muted) / 0.6)",
          opacity: bWins ? 0.55 : 1,
        }}
      >
        {format(aValue)}
      </p>
      <span className="font-display text-xs uppercase tracking-widest text-muted">
        {label}
      </span>
      <p
        className={`text-left ${fadedClass}`}
        style={{
          color: tied
            ? undefined
            : bWins
              ? "var(--faction-fg)"
              : "rgb(var(--color-muted) / 0.6)",
          opacity: aWins ? 0.55 : 1,
        }}
      >
        {format(bValue)}
      </p>
    </div>
  );
}
