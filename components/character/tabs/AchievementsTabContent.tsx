import type { CharacterDetail } from "@/lib/types";

export function AchievementsTabContent({ detail }: { detail: CharacterDetail }) {
  const ach = detail.achievements;

  if (!ach) {
    return (
      <p className="text-muted">
        Achievements unavailable. (Battle.net API may be rate-limited or this
        character has no public profile.)
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <section>
        <div className="grid gap-3 sm:grid-cols-2">
          <BigStat label="Earned" value={ach.totalQuantity.toLocaleString()} />
          <BigStat
            label="Total Points"
            value={ach.totalPoints.toLocaleString()}
            colorVar="var(--faction-fg)"
          />
        </div>
      </section>

      {ach.recent.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Recently Earned
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-md border border-border bg-surface">
            {ach.recent.map((a) => (
              <li
                key={a.id}
                className="flex items-baseline justify-between gap-3 px-4 py-2.5"
              >
                <a
                  href={`https://www.wowhead.com/achievement=${a.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-wowhead={`achievement=${a.id}&domain=us`}
                  className="font-display text-sm font-semibold hover:underline"
                  style={{ color: "var(--faction-fg)" }}
                >
                  {a.name}
                </a>
                <span className="shrink-0 font-display text-xs text-muted">
                  {new Date(a.timestamp).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ach.topCategories.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Top Categories by Points
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ach.topCategories.map((c) => (
              <div
                key={c.id}
                className="flex items-baseline justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2"
              >
                <span className="truncate font-display text-sm font-semibold">
                  {c.name}
                </span>
                <span className="shrink-0 font-display text-xs tabular-nums text-muted">
                  {c.quantity}
                  <span className="ml-2" style={{ color: "var(--faction-fg)" }}>
                    {c.points} pts
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function BigStat({
  label,
  value,
  colorVar,
}: {
  label: string;
  value: string;
  colorVar?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-5">
      <p className="font-display text-xs uppercase tracking-widest text-muted">
        {label}
      </p>
      <p
        className="mt-1 font-display text-4xl font-bold tabular-nums"
        style={colorVar ? { color: colorVar } : undefined}
      >
        {value}
      </p>
    </div>
  );
}
