import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { NavReady } from "@/components/NavReady";
import { TopRaiders } from "@/components/TopRaiders";
import {
  getCurrentTierKills,
  getGuildSnapshot,
  getRaidHistory,
} from "@/lib/raiderio";
import {
  CLASS_COLOR_VAR,
  type Boss,
  type BossKill,
  type GuildRanking,
  type KillParticipant,
  type RaidClear,
  type SubRaid,
  type TierState,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Progression — Lessons in Brutality",
};

export default async function ProgressionPage() {
  const snapshot = await getGuildSnapshot();
  const isLive = snapshot.source === "raiderio";
  const raidName = snapshot.tiers[0]?.raidName ?? "Current Tier";
  const tierIconUrl = snapshot.tierIconUrl;
  const tierExpansionName = snapshot.tierExpansionName;

  // Normal is intentionally omitted — it isn't tracked for prog.
  const orderedTiers = (["Mythic", "Heroic"] as const)
    .map((d) => snapshot.tiers.find((t) => t.difficulty === d))
    .filter((t): t is TierState => t != null);

  // Rankings: drop Normal here too.
  const visibleRankings = snapshot.rankings.filter(
    (r) => r.difficulty !== "Normal",
  );

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <NavReady />
      <p
        className="font-display text-xs uppercase tracking-[0.4em]"
        style={{ color: "var(--faction-fg)" }}
      >
        {tierExpansionName ?? "Tier Progress"}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold leading-tight sm:text-5xl">
          {raidName}
        </h1>
        <p className="text-xs uppercase tracking-widest text-muted">
          {isLive ? "Live · Raider.IO" : "Mock data (Raider.IO unavailable)"}
        </p>
      </div>

      {visibleRankings.length > 0 && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {visibleRankings.map((r) => (
            <RankingCard key={r.difficulty} ranking={r} />
          ))}
        </div>
      )}

      <Suspense
        fallback={
          <TierBoards
            tiers={orderedTiers}
            allTiers={snapshot.tiers}
            kills={{}}
            tierIconUrl={tierIconUrl}
          />
        }
      >
        <TierBoardsWithKills
          tiers={orderedTiers}
          allTiers={snapshot.tiers}
          tierIconUrl={tierIconUrl}
        />
      </Suspense>

      <Suspense fallback={null}>
        <TopRaidersSection />
      </Suspense>

      <Suspense fallback={null}>
        <RaidHistorySection />
      </Suspense>
    </section>
  );
}

async function TopRaidersSection() {
  const snapshot = await getGuildSnapshot();
  return <TopRaiders roster={snapshot.roster} />;
}

function TierBoards({
  tiers,
  allTiers,
  kills,
  tierIconUrl,
}: {
  tiers: TierState[];
  allTiers: TierState[];
  kills: Record<string, BossKill>;
  tierIconUrl?: string;
}) {
  return (
    <div className="mt-12 space-y-8">
      {tiers.map((tier) => (
        <TierBoard
          key={tier.difficulty}
          tier={tier}
          allTiers={allTiers}
          kills={kills}
          tierIconUrl={tierIconUrl}
        />
      ))}
    </div>
  );
}

async function TierBoardsWithKills({
  tiers,
  allTiers,
  tierIconUrl,
}: {
  tiers: TierState[];
  allTiers: TierState[];
  tierIconUrl?: string;
}) {
  const kills = await getCurrentTierKills();
  return (
    <TierBoards
      tiers={tiers}
      allTiers={allTiers}
      kills={kills}
      tierIconUrl={tierIconUrl}
    />
  );
}

async function RaidHistorySection() {
  const clears = await getRaidHistory();
  if (!clears.length) return null;
  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-3xl font-semibold">Raid History</h2>
        <p className="text-xs text-muted">
          All raids cleared by the guild · {clears.length} total
        </p>
      </div>
      <RaidHistoryByExpansion clears={clears} />
    </section>
  );
}

function RaidHistoryByExpansion({ clears }: { clears: RaidClear[] }) {
  // Group by expansion, preserving insertion order from the input (already
  // sorted newest-first by date, so the first-seen expansion is the most
  // recent one). Within each expansion, keep the date order.
  const groups = new Map<number, { name: string; clears: RaidClear[] }>();
  for (const c of clears) {
    let g = groups.get(c.expansionId);
    if (!g) {
      g = { name: c.expansionName, clears: [] };
      groups.set(c.expansionId, g);
    }
    g.clears.push(c);
  }
  return (
    <div className="mt-4 space-y-6">
      {[...groups.entries()]
        .sort(([a], [b]) => b - a)
        .map(([id, group]) => (
          <div key={id}>
            <h3
              className="font-display text-xs uppercase tracking-[0.3em]"
              style={{ color: "var(--faction-fg)" }}
            >
              {group.name}
            </h3>
            <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-surface">
              {group.clears.map((c) => (
                <RaidHistoryRow key={c.raidName} clear={c} />
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

const DIFFICULTY_COLOR: Record<RaidClear["difficulty"], string> = {
  Mythic: "#ff8000",
  Heroic: "#a335ee",
  Normal: "#0070dd",
};

function RaidHistoryRow({ clear }: { clear: RaidClear }) {
  const date = new Date(clear.completedAt).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
  const hasSlug = !!clear.raidSlug;
  const inner = (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {clear.iconUrl ? (
          <Image
            src={clear.iconUrl}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded border border-border"
          unoptimized
          />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded border border-border bg-background" />
        )}
        <div className="min-w-0">
          <p className="font-display text-base font-semibold">
            {clear.raidName}
          </p>
          <p className="font-display text-[10px] uppercase tracking-widest text-muted">
            Cleared {date}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {clear.heroicKilled !== undefined && clear.totalBosses !== undefined && (
          <DifficultyPill
            label="Heroic"
            killed={clear.heroicKilled}
            total={clear.totalBosses}
          />
        )}
        {clear.mythicKilled !== undefined &&
          clear.mythicKilled > 0 &&
          clear.totalBosses !== undefined && (
            <DifficultyPill
              label="Mythic"
              killed={clear.mythicKilled}
              total={clear.totalBosses}
            />
          )}
        {clear.heroicKilled === undefined && clear.mythicKilled === undefined && (
          <DifficultyPill label={clear.difficulty} />
        )}
      </div>
    </div>
  );
  return (
    <li>
      {hasSlug ? (
        <Link
          href={`/progression/raid/${clear.raidSlug}`}
          className="block transition-colors hover:bg-background/50"
        >
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}

function DifficultyPill({
  label,
  killed,
  total,
}: {
  label: "Normal" | "Heroic" | "Mythic";
  killed?: number;
  total?: number;
}) {
  const color = DIFFICULTY_COLOR[label];
  return (
    <span
      className="rounded border px-2.5 py-0.5 font-display text-xs uppercase tracking-widest tabular-nums"
      style={{ borderColor: color, color }}
    >
      {label}
      {killed !== undefined && total !== undefined && (
        <span>
          {" "}
          {killed}/{total}
        </span>
      )}
    </span>
  );
}

function RankingCard({ ranking }: { ranking: GuildRanking }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p
        className="font-display text-xs uppercase tracking-widest"
        style={{ color: "var(--faction-fg)" }}
      >
        {ranking.difficulty}
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Rank label="World" value={ranking.world} />
        <Rank label="Region" value={ranking.region} />
        <Rank label="Realm" value={ranking.realm} />
      </div>
    </div>
  );
}

function Rank({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-display text-[9px] uppercase tracking-widest text-muted">
        {label}
      </p>
      <p className="mt-0.5 font-display text-base font-semibold">
        {value > 0 ? value.toLocaleString() : "—"}
      </p>
    </div>
  );
}

function TierBoard({
  tier,
  allTiers,
  kills,
  tierIconUrl,
}: {
  tier: TierState;
  allTiers: TierState[];
  kills: Record<string, BossKill>;
  tierIconUrl?: string;
}) {
  const accent = DIFFICULTY_COLOR[tier.difficulty];

  // Sub-raid grouping: when the tier has sub-raids configured, render a
  // banner-card per sub-raid with its own art and slice of bosses. Otherwise
  // render a single card using the parent tier art.
  const subRaids: SubRaid[] = tier.subRaids?.length
    ? tier.subRaids
    : [
        {
          name: tier.raidName,
          iconUrl: tierIconUrl,
          bosses: tier.bosses,
          killed: tier.killed,
        },
      ];

  // Boss-index offset within the flat tier.bosses list — used to look up
  // kills (which are keyed by boss slug, not local sub-raid index).
  let cursor = 0;
  return (
    <section>
      {/* Difficulty heading sits above the sub-raid cards */}
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2
          className="font-display text-2xl font-bold uppercase tracking-[0.3em] sm:text-3xl"
          style={{ color: accent }}
        >
          {tier.difficulty}
        </h2>
        <p className="font-display text-sm tabular-nums text-muted sm:text-base">
          {tier.killed} <span className="text-muted">/</span> {tier.totalBosses}
        </p>
      </div>

      {/* All sub-raids share one outer bordered container per difficulty —
          saves the visual weight of 3× rounded cards stacked vertically. */}
      <div
        className="overflow-hidden rounded-md border bg-surface"
        style={{ borderColor: accent }}
      >
        {subRaids.map((sub, i) => {
          const offset = cursor;
          cursor += sub.bosses.length;
          return (
            <SubRaidSection
              key={sub.name}
              sub={sub}
              tier={tier}
              allTiers={allTiers}
              kills={kills}
              accent={accent}
              startIndex={offset}
              showTopDivider={i > 0}
            />
          );
        })}
      </div>
    </section>
  );
}

function SubRaidSection({
  sub,
  tier,
  allTiers,
  kills,
  accent,
  startIndex,
  showTopDivider,
}: {
  sub: SubRaid;
  tier: TierState;
  allTiers: TierState[];
  kills: Record<string, BossKill>;
  accent: string;
  startIndex: number;
  showTopDivider: boolean;
}) {
  const total = sub.bosses.length;
  const pct = total > 0 ? (sub.killed / total) * 100 : 0;

  // A sub-raid is "in active prog" at this difficulty if it has at least
  // one kill at this difficulty (sub.killed > 0), OR if it's been fully
  // cleared at the difficulty immediately below — the natural signal that
  // the guild has moved on to the next-difficulty version of this sub-raid.
  // Without this check, sub-raid #2+ at a difficulty with 0 kills (e.g.
  // Mythic Dreamrift's Chimaerus) shows as "Standing" instead of "Progging"
  // because the old `tier.killed >= startIndex` test assumed sequential
  // boss order across all sub-raids.
  const lowerDiff =
    tier.difficulty === "Mythic"
      ? "Heroic"
      : tier.difficulty === "Heroic"
        ? "Normal"
        : null;
  const lowerSub = lowerDiff
    ? allTiers
        .find((t) => t.difficulty === lowerDiff)
        ?.subRaids?.find((sr) => sr.name === sub.name)
    : null;
  const lowerCleared =
    !!lowerSub && lowerSub.killed >= lowerSub.bosses.length;
  const subRaidActive = sub.killed > 0 || lowerCleared;
  return (
    <div className={showTopDivider ? "border-t border-border" : ""}>
      {/* Compact banner — shorter than the per-card version since the outer
          difficulty container already provides framing. */}
      <div className="relative h-20 sm:h-24">
        {sub.iconUrl && (
          <Image
            src={sub.iconUrl}
            alt=""
            fill
            className="object-cover"
            sizes="(min-width: 1280px) 1280px, 100vw"
          unoptimized
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.25) 100%)",
          }}
        />
        <div className="relative flex h-full flex-col justify-end p-3 sm:p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-display text-lg font-bold leading-tight sm:text-xl">
              {sub.name}
            </h3>
            <p className="font-display text-xs tabular-nums text-muted">
              {sub.killed} / {total}
            </p>
          </div>
          <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-black/40">
            <div
              className="h-full"
              style={{ width: `${pct}%`, background: accent }}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3 xl:grid-cols-4">
        {(() => {
          // Prefer explicit killedSlugs (post-probing snapshots). Fall back
          // to prefix-slice for older snapshots that predate per-boss probes,
          // so the page keeps rendering during the transition window.
          const killedSet = sub.killedSlugs
            ? new Set(sub.killedSlugs)
            : new Set(sub.bosses.slice(0, sub.killed).map((b) => b.slug));
          // "Progging" is the first un-killed boss in display order, but
          // only when the sub-raid is in active prog (any kill at this
          // difficulty in this sub OR the lower difficulty fully cleared).
          const firstUnkilled = sub.bosses.findIndex(
            (b) => !killedSet.has(b.slug),
          );
          return sub.bosses.map((boss, localIdx) => {
            const globalIdx = startIndex + localIdx;
            const killed = killedSet.has(boss.slug);
            const isProg =
              !killed && localIdx === firstUnkilled && subRaidActive;
            const kill = kills[`${boss.slug}-${tier.difficulty}`];
            return (
              <BossCard
                key={boss.slug}
                boss={boss}
                index={globalIdx}
                killed={killed}
                isProg={isProg}
                kill={kill}
              />
            );
          });
        })()}
      </div>
    </div>
  );
}

function BossCard({
  boss,
  index,
  killed,
  isProg,
  kill,
}: {
  boss: Boss;
  index: number;
  killed: boolean;
  isProg: boolean;
  kill?: BossKill;
}) {
  return (
    <div
      className={`rounded-md border bg-surface p-4 transition-opacity ${
        killed
          ? "border-border"
          : isProg
          ? "border-border"
          : "border-border/50 opacity-50"
      }`}
      style={
        killed
          ? { borderLeft: "3px solid var(--faction)" }
          : isProg
          ? {
              borderLeft: "3px solid var(--faction)",
              borderStyle: "dashed",
            }
          : undefined
      }
    >
      <div className="flex items-center gap-3">
        {boss.iconUrl ? (
          <Image
            src={boss.iconUrl}
            alt=""
            width={48}
            height={48}
            className={`h-12 w-12 shrink-0 rounded border border-border object-cover ${
              killed || isProg ? "" : "grayscale"
            }`}
          unoptimized
          />
        ) : (
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-border bg-background font-display text-base font-bold tabular-nums"
            style={{
              color:
                killed || isProg ? "var(--faction-fg)" : "var(--color-muted)",
            }}
            aria-hidden
          >
            {index + 1}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p
            className="font-display text-xs uppercase tracking-widest"
            style={
              killed || isProg ? { color: "var(--faction-fg)" } : undefined
            }
          >
            {killed ? "Defeated" : isProg ? "Progging" : "Standing"}
          </p>
          <p className="mt-0.5 font-display text-base font-semibold leading-tight">
            {boss.name}
          </p>
        </div>
      </div>
      {killed && kill && <KillDetail kill={kill} />}
    </div>
  );
}

function KillDetail({ kill }: { kill: BossKill }) {
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
    <div className="mt-3 border-t border-border pt-2">
      <div className="grid grid-cols-2 gap-2 text-xs text-muted">
        <div>
          <p className="font-display text-[9px] uppercase tracking-widest">
            Killed
          </p>
          <p className="mt-0.5 font-display text-sm font-semibold text-foreground">
            {date}
          </p>
        </div>
        <div>
          <p className="font-display text-[9px] uppercase tracking-widest">
            Duration
          </p>
          <p className="mt-0.5 font-display text-sm font-semibold text-foreground">
            {duration}
          </p>
        </div>
      </div>
      {hasRoster && (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none font-display text-[10px] uppercase tracking-widest text-muted hover:text-foreground">
            <span className="group-open:hidden">
              ▸ Kill roster ({kill.roster.length})
            </span>
            <span className="hidden group-open:inline">▾ Kill roster</span>
          </summary>
          <ul className="mt-2 space-y-1">
            {kill.roster
              .slice()
              .sort((a, b) => roleOrder(a.role) - roleOrder(b.role))
              .map((p) => (
                <KillRosterRow key={`${p.realm}-${p.name}`} participant={p} />
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function KillRosterRow({ participant }: { participant: KillParticipant }) {
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
