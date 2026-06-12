import Link from "next/link";
import { CLASS_COLOR_VAR, type Character } from "@/lib/types";

/**
 * Top Raiders for the current tier — ranked by each character's personal
 * Heroic + Mythic boss kills (their raid_progression). This is the same
 * count shown on the character sheet's "Current Tier Progress", so the two
 * line up. (Previously this counted appearances in the guild's recorded
 * kill rosters, which undercounted anyone who killed bosses outside the
 * guild's specific recorded group.)
 */
export function TopRaiders({ roster }: { roster: Character[] }) {
  const ranked = roster
    .filter((c) => (c.tierKillsHM ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.tierKillsHM ?? 0) - (a.tierKillsHM ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 24);

  if (ranked.length === 0) return null;

  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-3xl font-semibold">Top Raiders</h2>
        <p className="text-xs text-muted">
          Most Heroic + Mythic boss kills · current tier
        </p>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ranked.map((c, i) => (
          <li key={`${c.realmSlug}-${c.name}`}>
            <Link
              href={`/character/${c.realmSlug}/${encodeURIComponent(c.name)}`}
              className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:border-foreground/30"
            >
              <span className="font-display text-base font-bold tabular-nums text-muted/70 w-6 shrink-0">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate font-display text-base font-semibold"
                  style={{ color: CLASS_COLOR_VAR[c.class] }}
                >
                  {c.name}
                </p>
                <p className="truncate text-[11px] text-muted">
                  {c.spec} · {c.role}
                </p>
              </div>
              <div className="flex shrink-0 items-baseline gap-1.5">
                <span className="font-display text-2xl font-bold tabular-nums">
                  {c.tierKillsHM ?? 0}
                </span>
                <span className="font-display text-[10px] uppercase tracking-widest text-muted">
                  kills
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
