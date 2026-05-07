"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type {
  Character,
  GuildRanking,
  GuildRun,
  TierState,
} from "@/lib/types";

type TopPlayer = {
  role: "tank" | "healer" | "dps";
  name: string;
  realmSlug: string;
  className: import("@/lib/types").WowClass;
  score: number;
  scoreColor?: string;
};

type Card =
  | { kind: "tier"; tier: TierState }
  | { kind: "topRun"; run: GuildRun }
  | { kind: "topByRole"; players: TopPlayer[] }
  | { kind: "ranking"; ranking: GuildRanking }
  | { kind: "rosterSize"; count: number; activeThisWeek: number }
  | { kind: "recruiting"; needs: { tank: number; healer: number; dps: number } };

const ROTATE_MS = 5500;

export function HeroPulsePanel({
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
  const cards: Card[] = [];

  // Card 1: in-progress tier (the hardest difficulty currently being worked).
  const tier =
    tiers.find((t) => t.killed > 0 && t.killed < t.totalBosses) ??
    tiers.find((t) => t.killed > 0) ??
    tiers[0];
  if (tier) cards.push({ kind: "tier", tier });

  // Card 2: top M+ key this week, if any.
  const topRun = weeklyTopRuns[0];
  if (topRun) cards.push({ kind: "topRun", run: topRun });

  // Card 3: top M+ score per role. roleScores splits each character's keys
  // by the role they were run as — a healer who PUGs DPS keys has both
  // values, so role-bucketing here is more honest than just role-of-active-spec.
  const topByRole: TopPlayer[] = (
    ["tank", "healer", "dps"] as const
  ).flatMap((role) => {
    const top = roster
      .filter((c) => (c.roleScores?.[role] ?? 0) > 0)
      .sort(
        (a, b) => (b.roleScores?.[role] ?? 0) - (a.roleScores?.[role] ?? 0),
      )[0];
    if (!top) return [];
    return [
      {
        role,
        name: top.name,
        realmSlug: top.realmSlug,
        className: top.class,
        // Use the per-role score, not the overall headline score.
        score: top.roleScores[role],
        // Color comes from RIO and tracks the headline score; for role-
        // specific scores it's a reasonable approximation.
        scoreColor: top.mythicPlusScoreColor,
      },
    ];
  });
  if (topByRole.length > 0) {
    cards.push({ kind: "topByRole", players: topByRole });
  }

  // Card 4: best regional ranking we've got (lower number = higher rank).
  const bestRanking = [...rankings]
    .filter((r) => r.region > 0)
    .sort((a, b) => a.region - b.region)[0];
  if (bestRanking) {
    cards.push({ kind: "ranking", ranking: bestRanking });
  }

  // Card 5: roster size + active-this-week count.
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
  const activeThisWeek = roster.filter(
    (c) => !!c.lastRunAt && Date.now() - c.lastRunAt < ONE_WEEK,
  ).length;
  if (roster.length > 0) {
    cards.push({
      kind: "rosterSize",
      count: roster.length,
      activeThisWeek,
    });
  }

  // Card 6: recruiting summary if any roles are short.
  if (
    recruitingNeeds &&
    recruitingNeeds.tank + recruitingNeeds.healer + recruitingNeeds.dps > 0
  ) {
    cards.push({ kind: "recruiting", needs: recruitingNeeds });
  }

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // Auto-rotate when there's more than one card to show. Pauses on hover.
  useEffect(() => {
    if (cards.length < 2 || paused) return;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % cards.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [cards.length, paused]);

  // Keep idx valid if cards array shrinks across renders.
  const safeIdx = Math.min(idx, Math.max(0, cards.length - 1));
  const active = cards[safeIdx];

  if (!active) return null;

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-border bg-surface/60 p-7 backdrop-blur"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Top-edge progress bar — visually communicates the auto-rotate.
          Keyed remount on each safeIdx change replays the animation. */}
      {cards.length > 1 && !paused && (
        <span
          key={`progress-${safeIdx}`}
          aria-hidden
          className="absolute left-0 top-0 h-0.5 origin-left"
          style={{
            background: "var(--faction)",
            animation: `lib-pulse-progress ${ROTATE_MS}ms linear forwards`,
            width: "100%",
          }}
        />
      )}
      {/* Faded animated card content — keying on safeIdx remounts the
          inner content so a fade-in plays each time the active card changes. */}
      <div key={`card-${safeIdx}`} className="lib-pulse-fade">
      {active.kind === "tier" && <TierCard tier={active.tier} />}
      {active.kind === "topRun" && <TopRunCard run={active.run} />}
      {active.kind === "topByRole" && (
        <TopByRoleCard players={active.players} />
      )}
      {active.kind === "ranking" && <RankingCard ranking={active.ranking} />}
      {active.kind === "rosterSize" && (
        <RosterSizeCard
          count={active.count}
          activeThisWeek={active.activeThisWeek}
        />
      )}
      {active.kind === "recruiting" && (
        <RecruitingCard needs={active.needs} />
      )}
      </div>

      {cards.length > 1 && (
        <div className="mt-5 flex items-center justify-center gap-2">
          {cards.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Card ${i + 1} of ${cards.length}`}
              onClick={() => {
                setIdx(i);
              }}
              className="h-2 w-7 rounded-full transition-colors"
              style={{
                background:
                  i === safeIdx ? "var(--faction)" : "rgba(255,255,255,0.18)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TierCard({ tier }: { tier: TierState }) {
  const difficulty = tier.difficulty;
  const next = tier.bosses[tier.killed];
  const pct =
    tier.totalBosses > 0 ? (tier.killed / tier.totalBosses) * 100 : 0;
  return (
    <>
      <div className="flex items-baseline justify-between">
        <p className="font-display text-sm uppercase tracking-[0.3em] text-muted">
          Current Tier
        </p>
        <p
          className="font-display text-sm uppercase tracking-[0.3em]"
          style={{ color: "var(--faction-fg)" }}
        >
          {difficulty}
        </p>
      </div>
      <h2 className="mt-2 font-display text-3xl font-semibold">
        {tier.raidName}
      </h2>
      <div className="mt-6 flex items-end gap-3">
        <span className="font-display text-7xl font-bold leading-none tabular-nums">
          {tier.killed}
        </span>
        <span className="pb-2 font-display text-3xl text-muted">
          / {tier.totalBosses} {difficulty[0]}
        </span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: "var(--faction)",
            boxShadow: "0 0 12px var(--faction)",
          }}
        />
      </div>
      {next && tier.killed < tier.totalBosses && (
        <div className="mt-6 border-t border-border pt-4">
          <p className="text-sm uppercase tracking-widest text-muted">
            Currently progging
          </p>
          <p className="mt-1 font-display text-xl font-semibold">{next.name}</p>
        </div>
      )}
    </>
  );
}

function TopRunCard({ run }: { run: GuildRun }) {
  const inTime = run.upgrades > 0;
  const chestLabel = inTime ? "+".repeat(run.upgrades + 1) : "Depleted";
  return (
    <>
      <div className="flex items-baseline justify-between">
        <p className="font-display text-sm uppercase tracking-[0.3em] text-muted">
          Top Key This Week
        </p>
        <p
          className="font-display text-sm uppercase tracking-[0.3em]"
          style={{ color: inTime ? "var(--faction-fg)" : "rgb(156,156,156)" }}
        >
          {chestLabel}
        </p>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <Image
          src={run.iconUrl}
          alt=""
          width={64}
          height={64}
          unoptimized
          className="h-16 w-16 shrink-0 rounded border border-border"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-3xl font-semibold leading-tight">
            +{run.level} {run.dungeon}
          </h2>
          <p className="mt-1 font-display text-sm text-muted">
            {Math.round(run.score)} pts
          </p>
        </div>
      </div>
      {run.runners?.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-sm uppercase tracking-widest text-muted">
            Run by
          </p>
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
            {run.runners.slice(0, 5).map((r) => (
              <span
                key={`${r.realmSlug}-${r.name}`}
                className="font-display text-lg font-semibold"
                style={{ color: `var(--color-class-${r.class})` }}
              >
                {r.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function RecruitingCard({
  needs,
}: {
  needs: { tank: number; healer: number; dps: number };
}) {
  const items = [
    { label: "Tanks", count: needs.tank, color: "#dc2626" },
    { label: "Healers", count: needs.healer, color: "#10b981" },
    { label: "DPS", count: needs.dps, color: "#f59e0b" },
  ].filter((i) => i.count > 0);

  return (
    <>
      <p className="font-display text-sm uppercase tracking-[0.3em] text-muted">
        Recruiting
      </p>
      <h2 className="mt-2 font-display text-3xl font-semibold">
        Open Spots
      </h2>
      <ul className="mt-5 space-y-3">
        {items.map((i) => (
          <li key={i.label} className="flex items-baseline justify-between">
            <span
              className="font-display text-base font-semibold uppercase tracking-widest"
              style={{ color: i.color }}
            >
              {i.label}
            </span>
            <span className="font-display text-4xl font-bold tabular-nums">
              {i.count}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-5 border-t border-border pt-3 text-sm text-muted">
        Whisper an officer in-game if any of these are you — see the recruit
        page for details.
      </p>
    </>
  );
}

const ROLE_LABEL: Record<TopPlayer["role"], string> = {
  tank: "Tank",
  healer: "Healer",
  dps: "DPS",
};
const ROLE_COLOR: Record<TopPlayer["role"], string> = {
  tank: "#dc2626",
  healer: "#10b981",
  dps: "#f59e0b",
};

function TopByRoleCard({ players }: { players: TopPlayer[] }) {
  return (
    <>
      <p className="font-display text-sm uppercase tracking-[0.3em] text-muted">
        Top M+ by Role
      </p>
      <ul className="mt-4 space-y-3">
        {players.map((p) => {
          const classColor = `var(--color-class-${p.className})`;
          return (
            <li
              key={p.role}
              className="flex items-baseline justify-between gap-3 border-b border-border pb-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-baseline gap-3">
                <span
                  className="font-display text-xs uppercase tracking-widest"
                  style={{ color: ROLE_COLOR[p.role], minWidth: "52px" }}
                >
                  {ROLE_LABEL[p.role]}
                </span>
                <span
                  className="truncate font-display text-xl font-semibold"
                  style={{ color: classColor }}
                >
                  {p.name}
                </span>
              </div>
              <span
                className="shrink-0 font-display text-3xl font-bold tabular-nums"
                style={
                  p.scoreColor && p.scoreColor !== "#ffffff"
                    ? { color: p.scoreColor }
                    : undefined
                }
              >
                {Math.round(p.score).toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function RankingCard({ ranking }: { ranking: GuildRanking }) {
  return (
    <>
      <div className="flex items-baseline justify-between">
        <p className="font-display text-sm uppercase tracking-[0.3em] text-muted">
          Best Ranking
        </p>
        <p
          className="font-display text-sm uppercase tracking-[0.3em]"
          style={{ color: "var(--faction-fg)" }}
        >
          {ranking.difficulty}
        </p>
      </div>
      <h2 className="mt-2 font-display text-3xl font-semibold">
        World{" "}
        <span style={{ color: "var(--faction-fg)" }}>
          #{ranking.world.toLocaleString()}
        </span>
      </h2>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border bg-background/50 p-3">
          <p className="font-display text-xs uppercase tracking-widest text-muted">
            Region
          </p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums">
            #{ranking.region.toLocaleString()}
          </p>
        </div>
        <div className="rounded-md border border-border bg-background/50 p-3">
          <p className="font-display text-xs uppercase tracking-widest text-muted">
            Realm
          </p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums">
            #{ranking.realm.toLocaleString()}
          </p>
        </div>
      </div>
    </>
  );
}

function RosterSizeCard({
  count,
  activeThisWeek,
}: {
  count: number;
  activeThisWeek: number;
}) {
  const pctActive = count > 0 ? (activeThisWeek / count) * 100 : 0;
  return (
    <>
      <p className="font-display text-sm uppercase tracking-[0.3em] text-muted">
        Active Roster
      </p>
      <div className="mt-3 flex items-end gap-3">
        <span className="font-display text-7xl font-bold leading-none tabular-nums">
          {count}
        </span>
        <span className="pb-2 font-display text-lg uppercase tracking-widest text-muted">
          raiders
        </span>
      </div>
      <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
        <span className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
        <p className="font-display text-base">
          <span className="font-bold tabular-nums">{activeThisWeek}</span>{" "}
          <span className="text-muted">active this week</span>
        </p>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-background">
        <div
          className="h-full bg-emerald-400/70"
          style={{ width: `${pctActive}%` }}
        />
      </div>
    </>
  );
}
