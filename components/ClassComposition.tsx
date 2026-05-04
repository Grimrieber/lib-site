import {
  CLASS_COLOR_VAR,
  CLASS_LABEL,
  type Character,
  type WowClass,
} from "@/lib/types";

const ALL_CLASSES: WowClass[] = [
  "deathknight",
  "demonhunter",
  "druid",
  "evoker",
  "hunter",
  "mage",
  "monk",
  "paladin",
  "priest",
  "rogue",
  "shaman",
  "warlock",
  "warrior",
];

export function ClassComposition({ roster }: { roster: Character[] }) {
  const counts = countBy(roster, (c) => c.class);
  const roleCounts = countBy(roster, (c) => c.role);
  const total = roster.length;

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p
          className="font-display text-xs uppercase tracking-[0.4em]"
          style={{ color: "var(--faction-fg)" }}
        >
          Composition
        </p>
        <div className="flex gap-4 text-xs">
          <RolePill label="Tank" count={roleCounts["tank"] ?? 0} />
          <RolePill label="Healer" count={roleCounts["healer"] ?? 0} />
          <RolePill label="DPS" count={roleCounts["dps"] ?? 0} />
          <RolePill label="Total" count={total} accent />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {ALL_CLASSES.filter((cls) => (counts[cls] ?? 0) > 0).map((cls) => (
          <ClassRow key={cls} cls={cls} count={counts[cls] ?? 0} total={total} />
        ))}
      </div>
    </div>
  );
}

function ClassRow({
  cls,
  count,
  total,
}: {
  cls: WowClass;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="truncate font-display text-xs font-semibold"
          style={{ color: CLASS_COLOR_VAR[cls] }}
        >
          {CLASS_LABEL[cls]}
        </span>
        <span className="font-display text-xs tabular-nums text-muted">
          {count}
        </span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: CLASS_COLOR_VAR[cls] }}
        />
      </div>
    </div>
  );
}

function RolePill({
  label,
  count,
  accent,
}: {
  label: string;
  count: number;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="font-display uppercase tracking-widest"
        style={{ color: accent ? "var(--faction-fg)" : "var(--color-muted)" }}
      >
        {label}
      </span>
      <span className="font-display text-base font-semibold tabular-nums">
        {count}
      </span>
    </div>
  );
}

function countBy<T, K extends string>(
  items: T[],
  key: (t: T) => K,
): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
