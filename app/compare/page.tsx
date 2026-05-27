import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { NavReady } from "@/components/NavReady";
import { ComparePicker } from "@/components/ComparePicker";
import { Skeleton } from "@/components/Skeleton";
import { GUILD } from "@/lib/config";
import { getCharacterDetail, getGuildSnapshot } from "@/lib/raiderio";
import {
  CLASS_COLOR_VAR,
  CLASS_LABEL,
  type CharacterDetail,
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
  const [a, b] = await Promise.all([
    aName
      ? getCharacterDetail(realmFor(aName), aName).catch(() => null)
      : Promise.resolve(null),
    bName
      ? getCharacterDetail(realmFor(bName), bName).catch(() => null)
      : Promise.resolve(null),
  ]);
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
                `${v}/${a.raidProgression?.totalBosses ?? "—"}`
              }
            />
            <DiffRow
              label="Mythic Kills"
              aValue={a.raidProgression.mythicKilled}
              bValue={b.raidProgression.mythicKilled}
              format={(v) =>
                `${v}/${a.raidProgression?.totalBosses ?? "—"}`
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
