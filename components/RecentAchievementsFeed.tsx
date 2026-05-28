import Link from "next/link";
import { CLASS_COLOR_VAR, type GuildAchievement } from "@/lib/types";

/**
 * Notable achievements earned across the active roster recently — AOTC, CE,
 * Hall of Fame, raid kill achievements, Glory metas, Keystone Master tiers.
 * Flat timeline of up to 50 entries, rendered in a fixed-height scrollable
 * panel so it doesn't dominate the page.
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
            Top {achievements.length} · raid kills, prestige titles, Keystone Masters
          </p>
        </div>

        <div className="achievements-scroll relative mt-6 max-h-[480px] overflow-y-auto rounded-md border border-border bg-background/60">
          <ul className="grid p-1 sm:grid-cols-2">
            {achievements.map((a, i) => (
              <AchievementRow
                key={`${a.character.name}-${a.id}`}
                item={a}
                stripe={i % 2 === 0}
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function AchievementRow({
  item,
  stripe,
}: {
  item: GuildAchievement;
  stripe: boolean;
}) {
  const { tag, color, clean } = categorize(item.name);
  const c = item.character;
  const classColor = CLASS_COLOR_VAR[c.class];
  return (
    <li
      className={`group relative flex items-center gap-2.5 overflow-hidden rounded px-2.5 py-2 transition-colors hover:bg-surface/60 ${stripe ? "bg-surface/20" : ""}`}
      title={`${item.name} — ${c.name} · ${relativeTime(item.timestamp)}`}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-0 w-[2px] rounded-r opacity-70 transition-opacity group-hover:opacity-100"
        style={{ backgroundColor: classColor }}
      />
      <span
        className="ml-1 flex h-5 shrink-0 items-center justify-center rounded px-1.5 font-display text-[10px] font-semibold uppercase leading-none tracking-wider"
        style={{
          color,
          borderColor: `color-mix(in srgb, ${color} 60%, transparent)`,
          borderWidth: 1,
          backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
        }}
      >
        {tag}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm leading-tight text-foreground/95">
        {clean}
      </span>
      <Link
        href={`/character/${c.realmSlug}/${encodeURIComponent(c.name)}`}
        className="shrink-0 truncate font-display text-xs font-semibold uppercase tracking-wider hover:underline"
        style={{ color: classColor }}
      >
        {c.name}
      </Link>
      <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-muted">
        {relativeTime(item.timestamp)}
      </span>
    </li>
  );
}

type AchCategory = {
  tag: string;
  color: string;
  clean: string;
};

/**
 * Map a raw achievement name to a short colored tag + cleaned display name.
 * Most notable achievements have a recognizable prefix ("Keystone Hero:",
 * "Mythic:", etc.) — we strip it so the body reads as the target (dungeon,
 * boss, raid) and the prefix becomes a category pill.
 */
function categorize(name: string): AchCategory {
  if (/^Keystone Legend/i.test(name))
    return {
      tag: "KL",
      color: "var(--color-class-druid)",
      clean: name.replace(/^Keystone Legend:\s*/i, ""),
    };
  if (/^Keystone Master/i.test(name))
    return {
      tag: "KM",
      color: "var(--color-class-druid)",
      clean: name.replace(/^Keystone Master:\s*/i, ""),
    };
  if (/^Keystone Hero/i.test(name))
    return {
      tag: "KH",
      color: "var(--color-class-druid)",
      clean: name.replace(/^Keystone Hero:\s*/i, ""),
    };
  if (/^Cutting Edge:/i.test(name))
    return {
      tag: "CE",
      color: "var(--color-class-deathknight)",
      clean: name.replace(/^Cutting Edge:\s*/i, ""),
    };
  if (/^Hall of Fame:/i.test(name))
    return {
      tag: "HoF",
      color: "var(--color-class-rogue)",
      clean: name.replace(/^Hall of Fame:\s*/i, ""),
    };
  if (/^Ahead of the Curve:/i.test(name))
    return {
      tag: "AOTC",
      color: "var(--color-class-hunter)",
      clean: name.replace(/^Ahead of the Curve:\s*/i, ""),
    };
  if (/^Mythic:/i.test(name))
    return {
      tag: "M",
      color: "var(--color-class-warlock)",
      clean: name.replace(/^Mythic:\s*/i, ""),
    };
  if (/^Heroic:/i.test(name))
    return {
      tag: "H",
      color: "var(--color-class-shaman)",
      clean: name.replace(/^Heroic:\s*/i, ""),
    };
  if (/^Glory of the/i.test(name))
    return {
      tag: "GLR",
      color: "var(--color-class-monk)",
      clean: name,
    };
  return {
    tag: "—",
    color: "var(--color-muted)",
    clean: name,
  };
}

function relativeTime(ms: number): string {
  const now = new Date();
  const then = new Date(ms);
  const diff = now.getTime() - then.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hr = Math.floor(mins / 60);
  if (hr < 24) return `${hr}h ago`;
  // Calendar-day diff in the viewer's local timezone — see
  // KeystoneCelebration.relativeTime for rationale.
  const nowMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thenMid = new Date(
    then.getFullYear(),
    then.getMonth(),
    then.getDate(),
  );
  const d = Math.max(
    1,
    Math.round((nowMid.getTime() - thenMid.getTime()) / 86_400_000),
  );
  if (d < 7) return `${d}d ago`;
  return then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
