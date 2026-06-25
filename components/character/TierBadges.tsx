import { formatCstDate } from "@/lib/cst";
import type { RaidTierBadges } from "@/lib/types";

/**
 * Visual badges for the current raid tier's prestige achievements.
 * Renders nothing if the character hasn't earned any.
 *
 * Color/label conventions match in-game:
 *   - AOTC: green (heroic-tier prestige)
 *   - Cutting Edge: orange (mythic kill before nerf cycle)
 *   - Hall of Fame: gold (top-100 mythic kill, faction-locked)
 */
export function TierBadges({ badges }: { badges: RaidTierBadges }) {
  const list: { label: string; full: string; color: string; ts: number }[] = [];
  if (badges.aotc) {
    list.push({
      label: "AOTC",
      full: "Ahead of the Curve",
      color: "#22c55e",
      ts: badges.aotc,
    });
  }
  if (badges.ce) {
    list.push({
      label: "CE",
      full: "Cutting Edge",
      color: "#f97316",
      ts: badges.ce,
    });
  }
  if (badges.hof) {
    list.push({
      label: "HoF",
      full: "Hall of Fame",
      color: "#facc15",
      ts: badges.hof,
    });
  }
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((b) => (
        <span
          key={b.label}
          title={`${b.full} · earned ${formatDate(b.ts)}`}
          className="rounded-full border px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-widest"
          style={{ borderColor: b.color, color: b.color }}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

function formatDate(ms: number): string {
  return formatCstDate(ms, { withYear: true });
}
