import Link from "next/link";
import {
  CLASS_COLOR_VAR,
  type BossKill,
  type KillParticipant,
} from "@/lib/types";

type Stat = {
  participant: KillParticipant;
  kills: number;
  difficulties: Set<string>;
};

/**
 * Top Raiders for the current tier. Counts how many of the current tier's
 * boss-kill rosters each guildy appears in across Heroic + Mythic. Useful
 * "MVP" stat — surfaces the people who actually showed up for kills.
 */
export function TopRaiders({
  kills,
}: {
  kills: Record<string, BossKill>;
}) {
  const byKey = new Map<string, Stat>();
  for (const kill of Object.values(kills)) {
    if (kill.difficulty === "Normal") continue; // Heroic + Mythic only.
    for (const p of kill.roster ?? []) {
      const key = `${p.realmSlug}/${p.name.toLowerCase()}`;
      const stat = byKey.get(key) ?? {
        participant: p,
        kills: 0,
        difficulties: new Set<string>(),
      };
      stat.kills += 1;
      stat.difficulties.add(kill.difficulty);
      byKey.set(key, stat);
    }
  }
  const ranked = [...byKey.values()]
    .sort((a, b) => b.kills - a.kills || a.participant.name.localeCompare(b.participant.name))
    .slice(0, 12);

  if (ranked.length === 0) return null;

  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-3xl font-semibold">Top Raiders</h2>
        <p className="text-xs text-muted">
          Most appearances in current-tier kill rosters · Heroic + Mythic
        </p>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ranked.map((s, i) => (
          <li key={`${s.participant.realmSlug}-${s.participant.name}`}>
            <Link
              href={`/character/${s.participant.realmSlug}/${encodeURIComponent(s.participant.name)}`}
              className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:border-foreground/30"
            >
              <span className="font-display text-base font-bold tabular-nums text-muted/70 w-6 shrink-0">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate font-display text-base font-semibold"
                  style={{ color: CLASS_COLOR_VAR[s.participant.class] }}
                >
                  {s.participant.name}
                </p>
                <p className="truncate text-[11px] text-muted">
                  {s.participant.spec} · {s.participant.role}
                </p>
              </div>
              <div className="flex shrink-0 items-baseline gap-1.5">
                <span className="font-display text-2xl font-bold tabular-nums">
                  {s.kills}
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
