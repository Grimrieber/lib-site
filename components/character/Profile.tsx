import Image from "next/image";
import { TalentBlock } from "./TalentBlock";
import { TierBadges } from "./TierBadges";
import {
  CLASS_COLOR_VAR,
  CLASS_LABEL,
  type CharacterCore,
  type CharacterDetail,
  type CharacterStats,
  type GearItem,
} from "@/lib/types";

const SLOT_LABEL: Record<string, string> = {
  head: "Head",
  neck: "Neck",
  shoulder: "Shoulder",
  back: "Back",
  chest: "Chest",
  wrist: "Wrist",
  hands: "Hands",
  waist: "Waist",
  legs: "Legs",
  feet: "Feet",
  finger1: "Ring",
  finger2: "Ring",
  trinket1: "Trinket",
  trinket2: "Trinket",
  mainhand: "Main Hand",
  offhand: "Off Hand",
};

const QUALITY_COLOR: Record<number, string> = {
  0: "#9d9d9d",
  1: "#ffffff",
  2: "#1eff00",
  3: "#0070dd",
  4: "#a335ee",
  5: "#ff8000",
};

const LEFT_SLOTS = [
  "head",
  "neck",
  "shoulder",
  "back",
  "chest",
  "wrist",
  "mainhand",
  "offhand",
];
const RIGHT_SLOTS = [
  "hands",
  "waist",
  "legs",
  "feet",
  "finger1",
  "finger2",
  "trinket1",
  "trinket2",
];

/** Fast hero — uses CharacterCore. Renders immediately on layout. */
export function ProfileHeader({
  core,
  hasLoadoutBelow,
}: {
  core: CharacterCore;
  hasLoadoutBelow: boolean;
}) {
  const classColor = CLASS_COLOR_VAR[core.classKey];
  return (
    <div
      className={`relative p-4 sm:p-5 ${hasLoadoutBelow ? "border-b border-border" : ""}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          {core.avatarUrl && (
            <div
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg sm:h-16 sm:w-16"
              style={{ border: `2px solid ${classColor}` }}
            >
              <Image
                src={core.avatarUrl}
                alt={core.name}
                fill
                sizes="64px"
                className="object-cover"
              unoptimized
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1
              className="truncate font-display text-2xl font-bold leading-tight sm:text-4xl"
              style={{ color: classColor }}
            >
              {core.name}
            </h1>
            <p className="truncate text-[11px] text-muted sm:text-sm">
              {core.race} · {core.spec} {core.className} · {core.realm}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 sm:ml-auto">
          <InlineStat label="ilvl" value={core.ilvl ?? "—"} />
          <InlineStat
            label="M+"
            value={
              core.mythicPlusScore && core.mythicPlusScore > 0
                ? Math.round(core.mythicPlusScore).toLocaleString()
                : "—"
            }
            color={core.mythicPlusScoreColor}
          />
          <InlineStat
            label="Ach"
            value={
              core.achievementPoints
                ? core.achievementPoints.toLocaleString()
                : "—"
            }
          />
        </div>
      </div>

      {(core.realmClassRank ||
        core.regionClassRank ||
        core.worldClassRank) && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
          {core.realmClassRank ? (
            <RankPill
              label={`#${core.realmClassRank.toLocaleString()} ${core.spec} ${CLASS_LABEL[core.classKey]} on Realm`}
            />
          ) : null}
          {core.regionClassRank ? (
            <RankPill
              label={`#${core.regionClassRank.toLocaleString()} in Region`}
            />
          ) : null}
          {core.worldClassRank ? (
            <RankPill
              label={`#${core.worldClassRank.toLocaleString()} in World`}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Wraps the whole profile section so the gradient + border are continuous. */
export function ProfileShell({
  core,
  children,
}: {
  core: CharacterCore;
  children: React.ReactNode;
}) {
  const classColor = CLASS_COLOR_VAR[core.classKey];
  const factionColor =
    core.faction === "alliance"
      ? "var(--color-alliance)"
      : "var(--color-horde)";
  return (
    <section
      className="relative overflow-hidden rounded-xl border border-border bg-surface"
      style={{ borderLeft: `4px solid ${factionColor}` }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          background: `radial-gradient(ellipse at top right, ${classColor}55 0%, transparent 70%)`,
        }}
      />
      {children}
    </section>
  );
}

/** Slow loadout — uses full CharacterDetail. Suspense-wrapped in layout. */
export function ProfileLoadout({ detail }: { detail: CharacterDetail }) {
  const hasLoadout = detail.stats || detail.gear.length > 0;
  if (!hasLoadout) return null;
  return (
    <div className="relative p-4 sm:p-5">
      {detail.tierBadges &&
        (detail.tierBadges.aotc ||
          detail.tierBadges.ce ||
          detail.tierBadges.hof) && (
          <div className="mb-4">
            <TierBadges badges={detail.tierBadges} />
          </div>
        )}

      <p
        className="font-display text-[10px] uppercase tracking-widest"
        style={{ color: "var(--faction-fg)" }}
      >
        Loadout
      </p>

      <div className="mt-3 lg:hidden">
        {detail.stats && <StatsList stats={detail.stats} />}
        {detail.gear.length > 0 && (
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            <GearColumn gear={detail.gear} slots={LEFT_SLOTS} iconSide="left" />
            <GearColumn gear={detail.gear} slots={RIGHT_SLOTS} iconSide="left" />
          </div>
        )}
      </div>

      <div className="mt-3 hidden items-stretch gap-4 lg:grid lg:grid-cols-[1fr_280px_1fr]">
        <GearColumn gear={detail.gear} slots={LEFT_SLOTS} iconSide="left" />
        {detail.stats ? <StatsList stats={detail.stats} /> : <div />}
        <GearColumn gear={detail.gear} slots={RIGHT_SLOTS} iconSide="right" />
      </div>

      {detail.talents && (
        <div className="mt-4">
          <TalentBlock talents={detail.talents} />
        </div>
      )}
    </div>
  );
}

/** Skeleton fallback shown while ProfileLoadout streams. Same general shape
 *  so layout doesn't shift when content arrives. */
export function ProfileLoadoutSkeleton() {
  return (
    <div className="relative p-4 sm:p-5">
      <div className="h-3 w-20 animate-pulse rounded bg-border/60" />
      <div className="mt-3 h-48 w-full animate-pulse rounded bg-border/30 sm:h-64" />
    </div>
  );
}

/** Backwards-compat wrapper: renders the full block from a detail object. */
export function ProfileBlock({ detail }: { detail: CharacterDetail }) {
  const hasLoadout = detail.stats || detail.gear.length > 0;
  return (
    <ProfileShell core={detail}>
      <ProfileHeader core={detail} hasLoadoutBelow={!!hasLoadout} />
      {hasLoadout && <ProfileLoadout detail={detail} />}
    </ProfileShell>
  );
}

function InlineStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="text-right">
      <span className="font-display text-[10px] uppercase tracking-widest text-muted">
        {label}
      </span>
      <span
        className="ml-1.5 font-display text-base font-bold tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function RankPill({ label }: { label: string }) {
  return (
    <span
      className="rounded-full border px-2.5 py-0.5 font-display"
      style={{ borderColor: "var(--faction)", color: "var(--faction-fg)" }}
    >
      {label}
    </span>
  );
}

function StatsList({ stats }: { stats: CharacterStats }) {
  const showTertiaries =
    stats.avoidance > 0 || stats.leech > 0 || stats.speed > 0;
  return (
    <aside className="flex flex-col rounded-md border border-border bg-surface px-4 py-3">
      <ul className="flex flex-1 flex-col justify-between gap-y-1">
        <SimpleRow
          label="Health"
          value={stats.health.toLocaleString()}
          valueColor="#dc2626"
        />
        <SimpleRow
          label={stats.primaryStatLabel}
          value={stats.primaryStatValue.toLocaleString()}
          valueColor="var(--faction-fg)"
        />
        <SimpleRow label="Stamina" value={stats.stamina.toLocaleString()} />
        <Divider />
        <PctRatingRow
          label="Crit"
          pct={stats.crit}
          rating={stats.critRating}
        />
        <PctRatingRow
          label="Haste"
          pct={stats.haste}
          rating={stats.hasteRating}
        />
        <PctRatingRow
          label="Mastery"
          pct={stats.mastery}
          rating={stats.masteryRating}
        />
        <PctRatingRow
          label="Versatility"
          pct={stats.versatility}
          rating={stats.versatilityRating}
        />
        {showTertiaries && (
          <>
            <Divider />
            <PctRatingRow
              label="Avoidance"
              pct={stats.avoidance}
              rating={stats.avoidanceRating}
              dim
            />
            <PctRatingRow
              label="Leech"
              pct={stats.leech}
              rating={stats.leechRating}
              dim
            />
            <PctRatingRow
              label="Speed"
              pct={stats.speed}
              rating={stats.speedRating}
              dim
            />
          </>
        )}
      </ul>
    </aside>
  );
}

function SimpleRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-sm">
      <span className="font-display text-xs uppercase tracking-widest text-muted">
        {label}
      </span>
      <span
        className="font-display text-base font-semibold tabular-nums"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
    </li>
  );
}

function PctRatingRow({
  label,
  pct,
  rating,
  dim,
}: {
  label: string;
  pct: number;
  rating: number;
  dim?: boolean;
}) {
  return (
    <li
      className={`flex items-baseline justify-between gap-3 text-sm ${dim ? "opacity-70" : ""}`}
    >
      <span className="font-display text-xs uppercase tracking-widest text-muted">
        {label}
      </span>
      <span className="font-display text-base font-semibold tabular-nums">
        {pct.toFixed(2)}%
        {rating > 0 && (
          <span className="ml-2 text-xs font-normal text-muted">
            {rating}
          </span>
        )}
      </span>
    </li>
  );
}

function Divider() {
  return <li className="my-0.5 border-t border-border" aria-hidden />;
}

function GearColumn({
  gear,
  slots,
  iconSide,
}: {
  gear: GearItem[];
  slots: string[];
  iconSide: "left" | "right";
}) {
  const bySlot = new Map(gear.map((g) => [g.slot, g]));
  return (
    <div className="space-y-1.5">
      {slots.map((slot) => {
        const item = bySlot.get(slot);
        return item ? (
          <GearRow key={slot} item={item} iconSide={iconSide} />
        ) : (
          <EmptyGearRow key={slot} slot={slot} iconSide={iconSide} />
        );
      })}
    </div>
  );
}

function GearRow({
  item,
  iconSide,
}: {
  item: GearItem;
  iconSide: "left" | "right";
}) {
  const qualityColor = QUALITY_COLOR[item.quality] ?? "#ffffff";
  const params: string[] = [];
  if (item.bonuses.length) params.push(`bonus=${item.bonuses.join(":")}`);
  if (item.gems.length) params.push(`gems=${item.gems.join(":")}`);
  if (item.enchants.length) params.push(`ench=${item.enchants[0]}`);
  const query = params.length ? `?${params.join("&")}` : "";
  const href = `https://www.wowhead.com/item=${item.itemId}${query}`;
  const dataWowhead = `item=${item.itemId}${
    params.length ? `&${params.join("&")}` : ""
  }&domain=us`;

  const icon = (
    <div
      className="relative h-10 w-10 shrink-0 overflow-hidden rounded"
      style={{ border: `1px solid ${qualityColor}` }}
    >
      <Image
        src={item.iconUrl}
        alt=""
        fill
        sizes="40px"
        className="object-cover"
      unoptimized
      />
    </div>
  );
  const text = (
    <div
      className={`min-w-0 flex-1 ${iconSide === "right" ? "text-right" : ""}`}
    >
      <p
        className="truncate font-display text-sm font-semibold leading-tight"
        style={{ color: qualityColor }}
      >
        {item.name}
      </p>
      <p className="font-display text-xs tabular-nums text-muted">
        {item.itemLevel}
      </p>
    </div>
  );

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-wowhead={dataWowhead}
      className="flex items-center gap-3 rounded transition-colors hover:bg-surface"
    >
      {iconSide === "left" ? (
        <>
          {icon}
          {text}
        </>
      ) : (
        <>
          {text}
          {icon}
        </>
      )}
    </a>
  );
}

function EmptyGearRow({
  slot,
  iconSide,
}: {
  slot: string;
  iconSide: "left" | "right";
}) {
  const icon = (
    <div className="h-10 w-10 shrink-0 rounded border border-dashed border-border/50 bg-surface/30" />
  );
  const text = (
    <div
      className={`min-w-0 flex-1 ${iconSide === "right" ? "text-right" : ""}`}
    >
      <p className="font-display text-xs uppercase tracking-widest text-muted/50">
        {SLOT_LABEL[slot] ?? slot}
      </p>
    </div>
  );
  return (
    <div className="flex items-center gap-3 rounded opacity-60">
      {iconSide === "left" ? (
        <>
          {icon}
          {text}
        </>
      ) : (
        <>
          {text}
          {icon}
        </>
      )}
    </div>
  );
}
