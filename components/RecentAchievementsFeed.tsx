import Link from "next/link";
import { CLASS_COLOR_VAR, type GuildAchievement } from "@/lib/types";

/**
 * Notable achievements earned across the active roster recently — AOTC, CE,
 * Hall of Fame, raid kill achievements, Glory metas, Keystone Master tiers.
 * Filtering happens upstream in `getCharacterTierData`; this component just
 * renders the timeline.
 */
export function RecentAchievementsFeed({
  achievements,
}: {
  achievements: GuildAchievement[];
}) {
  if (!achievements.length) return null;

  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p
              className="font-display text-xs uppercase tracking-[0.4em]"
              style={{ color: "var(--faction-fg)" }}
            >
              Lately
            </p>
            <h2 className="mt-2 font-display text-3xl font-semibold">
              Recent Guild Achievements
            </h2>
          </div>
          <p className="text-xs text-muted">
            Raid kills, prestige titles, Keystone Masters
          </p>
        </div>

        <ul className="mt-6 grid gap-2 sm:grid-cols-2">
          {achievements.map((a) => (
            <AchievementRow key={`${a.character.name}-${a.id}`} item={a} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function AchievementRow({ item }: { item: GuildAchievement }) {
  const { character: c } = item;
  const classColor = CLASS_COLOR_VAR[c.class];
  return (
    <li className="flex items-baseline gap-3 rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-semibold leading-tight">
          {item.name}
        </p>
        <p className="mt-0.5 text-[11px] text-muted">
          <Link
            href={`/character/${c.realmSlug}/${encodeURIComponent(c.name)}`}
            className="font-display font-semibold hover:underline"
            style={{ color: classColor }}
          >
            {c.name}
          </Link>
          <span> · {relativeTime(item.timestamp)}</span>
        </p>
      </div>
    </li>
  );
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hr = Math.floor(mins / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
