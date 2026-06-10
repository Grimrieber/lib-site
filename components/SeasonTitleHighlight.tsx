import Image from "next/image";
import Link from "next/link";
import { CLASS_COLOR_VAR, type SeasonTitleAward } from "@/lib/types";

const TITLE_GOLD = "#f4c84b";

/** Avatar URL is carried alongside the award so the section can render the
 *  holder's portrait without re-fetching. Resolved in app/page.tsx from the
 *  snapshot roster. */
export type SeasonTitleHolder = SeasonTitleAward & { avatarUrl?: string };

/**
 * Home-page marquee for the guild's Mythic+ seasonal title holders — the
 * top-0.1% "Hero" title (e.g. "the Unbound Hero"). The rarest flex on the
 * roster, so it gets its own gold section. Renders nothing until someone
 * holds one. Season-agnostic: whatever the current season's title is, it
 * shows here automatically.
 */
export function SeasonTitleHighlight({
  holders,
}: {
  holders: SeasonTitleHolder[];
}) {
  if (!holders.length) return null;
  // Every holder this season shares the same title/season — headline it once.
  const season = holders[0].season;

  return (
    <section
      className="border-b border-border"
      style={{
        background:
          "linear-gradient(180deg, rgba(244,200,75,0.07) 0%, transparent 60%)",
      }}
    >
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p
              className="lib-title-glow font-display text-xs uppercase tracking-[0.4em]"
              style={{ color: TITLE_GOLD }}
            >
              ★ Top 0.1%
            </p>
            <h2 className="mt-2 font-display text-3xl font-semibold">
              Mythic+ Title Holders
            </h2>
          </div>
          <p className="text-xs text-muted">
            {season} · the title goes to the top 0.1% of the region
          </p>
        </div>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {holders.map((h) => (
            <HolderCard key={`${h.runner.name}@${h.runner.realmSlug}`} holder={h} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function HolderCard({ holder }: { holder: SeasonTitleHolder }) {
  const classColor = CLASS_COLOR_VAR[holder.runner.class];
  return (
    <li>
      <Link
        href={`/character/${holder.runner.realmSlug}/${encodeURIComponent(
          holder.runner.name,
        )}`}
        className="lib-title-shimmer relative flex items-center gap-3 overflow-hidden rounded-lg border p-3 transition-colors hover:bg-background/60"
        style={{
          borderColor: `${TITLE_GOLD}66`,
          background:
            "linear-gradient(180deg, rgba(244,200,75,0.06) 0%, transparent 70%)",
        }}
      >
        {holder.avatarUrl ? (
          <div
            className="relative h-12 w-12 shrink-0 overflow-hidden rounded"
            style={{ border: `2px solid ${TITLE_GOLD}` }}
          >
            <Image
              src={holder.avatarUrl}
              alt={holder.runner.name}
              fill
              sizes="48px"
              className="object-cover"
              unoptimized
            />
          </div>
        ) : (
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded font-display text-lg font-bold"
            style={{ border: `2px solid ${TITLE_GOLD}`, color: classColor }}
          >
            {holder.runner.name[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p
            className="truncate font-display text-lg font-semibold leading-tight"
            style={{ color: classColor }}
          >
            {holder.runner.name}
          </p>
          <p
            className="lib-title-glow truncate font-display text-xs font-bold uppercase tracking-widest"
            style={{ color: TITLE_GOLD }}
          >
            <span className="lib-title-star mr-0.5 inline-block">★</span>
            {holder.title}
          </p>
          {holder.score > 0 && (
            <p className="mt-0.5 text-[11px] text-muted">
              {Math.round(holder.score).toLocaleString()} M+ score
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}
