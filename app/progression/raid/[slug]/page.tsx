import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NavReady } from "@/components/NavReady";
import { getPastRaidDetail, getRaidHistory } from "@/lib/raiderio";
import {
  CLASS_COLOR_VAR,
  type BossKill,
  type Difficulty,
  type KillParticipant,
} from "@/lib/types";

type Props = {
  params: Promise<{ slug: string }>;
};

const DIFFICULTIES: { key: Difficulty; color: string }[] = [
  { key: "Mythic", color: "#ff8000" },
  { key: "Heroic", color: "#a335ee" },
  { key: "Normal", color: "#0070dd" },
];

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const detail = await getPastRaidDetail(slug);
  return {
    title: `${detail?.name ?? "Raid"} — Lessons in Brutality`,
  };
}

/**
 * Pre-render all known past-raid pages at build time so users get fast
 * loads on first visit. Falls back to on-demand for any slug not in this
 * list (e.g. when next tier rolls over).
 */
export async function generateStaticParams() {
  try {
    const clears = await getRaidHistory();
    return clears.map((c) => ({ slug: c.raidSlug }));
  } catch {
    return [];
  }
}

export default async function PastRaidPage({ params }: Props) {
  const { slug } = await params;
  const detail = await getPastRaidDetail(slug);
  if (!detail) notFound();

  const totalBosses = detail.encounters.length;
  const noKills =
    detail.totals.Mythic === 0 &&
    detail.totals.Heroic === 0 &&
    detail.totals.Normal === 0;

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <NavReady />
      <Link
        href="/progression"
        className="font-display text-xs uppercase tracking-widest text-muted hover:text-foreground"
      >
        ← Progression
      </Link>

      <div className="mt-4 flex items-center gap-4">
        {detail.iconUrl && (
          <Image
            src={detail.iconUrl}
            alt=""
            width={64}
            height={64}
            className="h-12 w-12 shrink-0 rounded border border-border sm:h-16 sm:w-16"
          unoptimized
          />
        )}
        <div className="min-w-0">
          <p
            className="font-display text-xs uppercase tracking-[0.4em]"
            style={{ color: "var(--faction-fg)" }}
          >
            {detail.expansionName}
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold leading-tight sm:text-5xl">
            {detail.name}
          </h1>
        </div>
      </div>

      {noKills ? (
        <p className="mt-8 text-muted">
          No guild kills recorded for this raid.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {DIFFICULTIES.map((d) => (
              <DifficultyStat
                key={d.key}
                label={d.key}
                color={d.color}
                killed={detail.totals[d.key]}
                total={totalBosses}
              />
            ))}
          </div>

          <div className="mt-10 space-y-3">
            {detail.encounters.map((boss, idx) => {
              const perDiff: Partial<Record<Difficulty, BossKill>> = {};
              for (const diff of DIFFICULTIES.map((d) => d.key)) {
                const k = detail.kills[`${boss.slug}-${diff}`];
                if (k) perDiff[diff] = k;
              }
              const highest =
                DIFFICULTIES.find((d) => perDiff[d.key])?.key ?? null;
              return (
                <BossCard
                  key={boss.slug}
                  index={idx + 1}
                  boss={boss}
                  perDifficulty={perDiff}
                  highest={highest}
                />
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function DifficultyStat({
  label,
  color,
  killed,
  total,
}: {
  label: string;
  color: string;
  killed: number;
  total: number;
}) {
  const pct = total > 0 ? (killed / total) * 100 : 0;
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p
        className="font-display text-xs uppercase tracking-widest"
        style={{ color }}
      >
        {label}
      </p>
      <p className="mt-1 font-display text-3xl font-bold">
        {killed}
        <span className="text-lg text-muted"> / {total}</span>
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function BossCard({
  index,
  boss,
  perDifficulty,
  highest,
}: {
  index: number;
  boss: { name: string; slug: string; iconUrl?: string };
  perDifficulty: Partial<Record<Difficulty, BossKill>>;
  highest: Difficulty | null;
}) {
  const cleared = highest != null;
  const highestKill = highest ? perDifficulty[highest] : null;

  return (
    <div
      className={`rounded-md border bg-surface ${cleared ? "border-border" : "border-border/40 opacity-60"}`}
      style={
        highest
          ? {
              borderLeft: `3px solid ${
                highest === "Mythic"
                  ? "#ff8000"
                  : highest === "Heroic"
                    ? "#a335ee"
                    : "#0070dd"
              }`,
            }
          : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
        {boss.iconUrl && (
          <Image
            src={boss.iconUrl}
            alt=""
            width={64}
            height={64}
            className="h-14 w-14 shrink-0 rounded border border-border object-cover sm:h-16 sm:w-16"
          unoptimized
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-display text-[10px] uppercase tracking-widest text-muted">
            Boss {index}
          </p>
          <h3 className="font-display text-lg font-semibold leading-tight">
            {boss.name}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {DIFFICULTIES.map((d) => {
            const kill = perDifficulty[d.key];
            const killed = !!kill;
            return (
              <span
                key={d.key}
                title={
                  killed
                    ? `${d.key} cleared`
                    : `${d.key} not yet defeated`
                }
                className={`rounded-md border-2 px-2.5 py-1 font-display text-xs font-bold uppercase tracking-widest ${killed ? "" : "border-border/40 text-muted/50"}`}
                style={
                  killed
                    ? { borderColor: d.color, color: d.color }
                    : undefined
                }
              >
                {d.key[0]}
              </span>
            );
          })}
        </div>
      </div>

      {cleared && (
        <div className="border-t border-border px-3 py-3 sm:px-4">
          <div className="space-y-2">
            {DIFFICULTIES.map((d) => {
              const kill = perDifficulty[d.key];
              if (kill) {
                return (
                  <BossKillExpand
                    key={d.key}
                    kill={kill}
                    difficulty={d.key}
                    color={d.color}
                  />
                );
              }
              return (
                <div
                  key={d.key}
                  className="font-display text-sm font-semibold uppercase tracking-widest text-muted"
                >
                  <span style={{ color: d.color }}>{d.key}</span>
                  <span className="text-muted/60"> · Not Cleared</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BossKillExpand({
  kill,
  difficulty,
  color,
}: {
  kill: BossKill;
  difficulty: Difficulty;
  color: string;
}) {
  const date = new Date(kill.defeatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const mins = Math.floor(kill.durationMs / 60_000);
  const secs = Math.floor((kill.durationMs % 60_000) / 1000);
  const duration = `${mins}:${secs.toString().padStart(2, "0")}`;
  const hasRoster = kill.roster && kill.roster.length > 0;

  return (
    <details className="group">
      <summary className="cursor-pointer list-none font-display text-sm font-semibold uppercase tracking-widest text-muted hover:text-foreground">
        <span className="group-open:hidden">
          ▸ <span style={{ color }}>{difficulty}</span> kill roster
          {hasRoster && <> ({kill.roster.length})</>}
          <span className="ml-2 text-[11px] font-normal text-muted/70">
            {date} · {duration} · {Math.round(kill.avgIlvl)} ilvl
          </span>
        </span>
        <span className="hidden group-open:inline">
          ▾ <span style={{ color }}>{difficulty}</span> kill roster
          <span className="ml-2 text-[11px] font-normal text-muted/70">
            {date} · {duration} · {Math.round(kill.avgIlvl)} ilvl
          </span>
        </span>
      </summary>
      {hasRoster && (
        <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {kill.roster
            .slice()
            .sort((a, b) => roleOrder(a.role) - roleOrder(b.role))
            .map((p) => (
              <RosterRow key={`${p.realm}-${p.name}`} participant={p} />
            ))}
        </ul>
      )}
    </details>
  );
}

function RosterRow({ participant }: { participant: KillParticipant }) {
  const classColor = CLASS_COLOR_VAR[participant.class];
  return (
    <li className="text-xs">
      <Link
        href={`/character/${participant.realmSlug}/${encodeURIComponent(participant.name)}`}
        className="hover:underline"
        style={{ color: classColor }}
      >
        {participant.name}
      </Link>
      <span className="text-muted"> · {participant.spec}</span>
    </li>
  );
}

function roleOrder(role: KillParticipant["role"]): number {
  if (role === "tank") return 0;
  if (role === "healer") return 1;
  return 2;
}
