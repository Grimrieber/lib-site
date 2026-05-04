import { IDEAL_MYTHIC_COMP } from "@/lib/config";
import type { Character, Role } from "@/lib/types";

type GapRow = {
  role: Role;
  label: string;
  current: number;
  target: number;
  gap: number;
};

/**
 * "Currently Recruiting" card derived from the live roster vs the
 * configured ideal composition. Buckets characters by their currently
 * active spec role (raid-time relevant), not their best-scoring M+ role.
 *
 * If the roster meets/exceeds every target, renders a "fully staffed"
 * message instead — the card is always informative, never empty.
 */
export function CompositionGap({ roster }: { roster: Character[] }) {
  const counts: Record<Role, number> = { tank: 0, healer: 0, dps: 0 };
  for (const c of roster) counts[c.role] += 1;

  const rows: GapRow[] = [
    {
      role: "tank",
      label: "Tanks",
      current: counts.tank,
      target: IDEAL_MYTHIC_COMP.tank,
      gap: IDEAL_MYTHIC_COMP.tank - counts.tank,
    },
    {
      role: "healer",
      label: "Healers",
      current: counts.healer,
      target: IDEAL_MYTHIC_COMP.healer,
      gap: IDEAL_MYTHIC_COMP.healer - counts.healer,
    },
    {
      role: "dps",
      label: "DPS",
      current: counts.dps,
      target: IDEAL_MYTHIC_COMP.dps,
      gap: IDEAL_MYTHIC_COMP.dps - counts.dps,
    },
  ];

  const needs = rows.filter((r) => r.gap > 0);
  const fullyStaffed = needs.length === 0;

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p
          className="font-display text-xs uppercase tracking-[0.4em]"
          style={{ color: "var(--faction-fg)" }}
        >
          Currently Recruiting
        </p>
        <p className="text-[10px] uppercase tracking-widest text-muted">
          Auto-derived from active roster
        </p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {rows.map((r) => (
          <RoleCard key={r.role} row={r} />
        ))}
      </div>

      <p className="mt-3 text-xs text-muted">
        {fullyStaffed
          ? "Roster is at target across every role. Strong applicants still get a look — we recruit the player, not the spec."
          : `Looking for ${needs
              .map((n) => `${n.gap} ${n.label.toLowerCase()}`)
              .join(", ")}. Off-list applicants still get a look — we recruit the player, not the spec.`}
      </p>
    </section>
  );
}

function RoleCard({ row }: { row: GapRow }) {
  const surplus = row.gap < 0;
  const need = row.gap > 0;
  const accent = need
    ? "var(--faction-fg)"
    : surplus
    ? "var(--color-muted)"
    : "var(--color-foreground)";
  return (
    <div className="rounded-md border border-border bg-background p-3 text-center">
      <p
        className="font-display text-[10px] uppercase tracking-widest"
        style={{ color: "var(--faction-fg)" }}
      >
        {row.label}
      </p>
      <p
        className="mt-1 font-display text-2xl font-bold tabular-nums"
        style={{ color: accent }}
      >
        {row.current}
        <span className="text-sm font-normal text-muted"> / {row.target}</span>
      </p>
      <p className="text-[10px] uppercase tracking-widest text-muted">
        {need ? `Need ${row.gap}` : surplus ? `+${-row.gap} over` : "On target"}
      </p>
    </div>
  );
}
