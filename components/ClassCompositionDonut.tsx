import {
  CLASS_COLOR_VAR,
  CLASS_LABEL,
  type Character,
  type WowClass,
} from "@/lib/types";

const CLASS_ORDER: WowClass[] = [
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

/**
 * SVG donut chart of the active roster's class breakdown. Shown on the home
 * page so visitors can read raid composition at a glance — class colors do
 * the heavy lifting since WoW players read those reflexively.
 */
export function ClassCompositionDonut({ roster }: { roster: Character[] }) {
  if (!roster.length) return null;

  const counts: Record<WowClass, number> = {
    deathknight: 0,
    demonhunter: 0,
    druid: 0,
    evoker: 0,
    hunter: 0,
    mage: 0,
    monk: 0,
    paladin: 0,
    priest: 0,
    rogue: 0,
    shaman: 0,
    warlock: 0,
    warrior: 0,
  };
  for (const c of roster) counts[c.class] += 1;

  const present = CLASS_ORDER.filter((k) => counts[k] > 0);
  const total = roster.length;

  // Donut geometry. 0–360 sweep, broken into per-class arcs.
  const cx = 60;
  const cy = 60;
  const rOuter = 50;
  const rInner = 32;

  let cumulative = 0;
  const arcs = present.map((cls) => {
    const value = counts[cls];
    const startAngle = (cumulative / total) * 360;
    cumulative += value;
    const endAngle = (cumulative / total) * 360;
    return {
      cls,
      value,
      d: arcPath(cx, cy, rOuter, rInner, startAngle, endAngle),
    };
  });

  return (
    <section className="border-b border-border bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        <p
          className="font-display text-xs uppercase tracking-[0.4em]"
          style={{ color: "var(--faction-fg)" }}
        >
          Roster
        </p>
        <h2 className="mt-2 font-display text-3xl font-semibold">
          Class Composition
        </h2>

        <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
          <div className="relative">
            <svg
              viewBox="0 0 120 120"
              className="h-40 w-40 sm:h-48 sm:w-48"
              role="img"
              aria-label={`Roster class composition: ${total} active raiders`}
            >
              {arcs.map((a) => (
                <path
                  key={a.cls}
                  d={a.d}
                  fill={CLASS_COLOR_VAR[a.cls]}
                  stroke="var(--color-background)"
                  strokeWidth="0.5"
                />
              ))}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="font-display text-3xl font-bold tabular-nums">
                {total}
              </p>
              <p className="font-display text-[10px] uppercase tracking-widest text-muted">
                Active
              </p>
            </div>
          </div>

          <ul className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
            {present.map((cls) => (
              <li key={cls} className="flex items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: CLASS_COLOR_VAR[cls] }}
                />
                <span
                  className="truncate font-display text-sm"
                  style={{ color: CLASS_COLOR_VAR[cls] }}
                >
                  {CLASS_LABEL[cls]}
                </span>
                <span className="ml-auto font-display text-sm tabular-nums text-muted">
                  {counts[cls]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * Build an SVG path for an annular sector (donut slice) from `start` to `end`
 * degrees. 0° points up, sweeping clockwise.
 */
function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startDeg: number,
  endDeg: number,
): string {
  const startOuter = polar(cx, cy, rOuter, startDeg);
  const endOuter = polar(cx, cy, rOuter, endDeg);
  const startInner = polar(cx, cy, rInner, endDeg);
  const endInner = polar(cx, cy, rInner, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
    "Z",
  ].join(" ");
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
