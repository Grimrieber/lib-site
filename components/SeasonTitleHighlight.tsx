import Image from "next/image";
import Link from "next/link";
import {
  CLASS_COLOR_VAR,
  type SeasonTitleAward,
  type SeasonTitleTier,
} from "@/lib/types";

/** Per-tier flair, matching SeasonTitleBadge. Gold = top-0.1% Hero title,
 *  silver = top-1% Champion achievement. */
const TIER_STYLE: Record<
  SeasonTitleTier,
  {
    color: string;
    star: string;
    glow: string;
    shimmer: string;
    pct: string;
    blurb: string;
  }
> = {
  hero: {
    color: "#f4c84b",
    star: "lib-title-star",
    glow: "lib-title-glow",
    shimmer: "lib-title-shimmer",
    pct: "Top 0.1%",
    blurb: "the title goes to the top 0.1% of the region",
  },
  champion: {
    color: "#c9d4e6",
    star: "lib-title-star-silver",
    glow: "lib-title-glow-silver",
    shimmer: "lib-title-shimmer-silver",
    pct: "Top 1%",
    blurb: "the top 1% of the region at season's end",
  },
};

const tierOf = (h: SeasonTitleAward): SeasonTitleTier => h.tier ?? "hero";

/** Avatar URL is carried alongside the award so the section can render the
 *  holder's portrait without re-fetching. Resolved in app/page.tsx from the
 *  snapshot roster. */
export type SeasonTitleHolder = SeasonTitleAward & { avatarUrl?: string };

/**
 * Home-page marquee for the guild's Mythic+ end-of-season accolade holders.
 * Two tiers, gold over silver:
 *   - top-0.1% "Hero" title (e.g. "the Umbral Hero") — the headline section.
 *   - top-1% "Champion" achievement (e.g. "Umbral Champion") — a silver
 *     sub-tier beneath, only shown when someone holds it.
 * Renders nothing until someone holds either. Season-agnostic: whatever the
 * current season's accolades are, they show here automatically (the Champion
 * heading is derived from the holders' own name).
 */
export function SeasonTitleHighlight({
  holders,
}: {
  holders: SeasonTitleHolder[];
}) {
  if (!holders.length) return null;
  const heroes = holders.filter((h) => tierOf(h) === "hero");
  const champions = holders.filter((h) => tierOf(h) === "champion");

  return (
    <section
      className="border-b border-border"
      style={{
        background:
          "linear-gradient(180deg, rgba(244,200,75,0.07) 0%, transparent 60%)",
      }}
    >
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        {heroes.length > 0 && (
          <TierBlock
            tier="hero"
            heading="Mythic+ Title Holders"
            holders={heroes}
          />
        )}
        {champions.length > 0 && (
          <div
            className={
              heroes.length > 0 ? "mt-10 border-t border-border/60 pt-8" : ""
            }
          >
            <TierBlock
              tier="champion"
              // e.g. "Umbral Champion" → "Umbral Champions" — self-updates each season.
              heading={`${champions[0].name}s`}
              holders={champions}
              smaller
            />
          </div>
        )}
      </div>
    </section>
  );
}

function TierBlock({
  tier,
  heading,
  holders,
  smaller,
}: {
  tier: SeasonTitleTier;
  heading: string;
  holders: SeasonTitleHolder[];
  smaller?: boolean;
}) {
  const s = TIER_STYLE[tier];
  const season = holders[0].season;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p
            className={`${s.glow} font-display text-xs uppercase tracking-[0.4em]`}
            style={{ color: s.color }}
          >
            ★ {s.pct}
          </p>
          {smaller ? (
            <h3 className="mt-2 font-display text-2xl font-semibold">
              {heading}
            </h3>
          ) : (
            <h2 className="mt-2 font-display text-3xl font-semibold">
              {heading}
            </h2>
          )}
        </div>
        <p className="text-xs text-muted">
          {season} · {s.blurb}
        </p>
      </div>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {holders.map((h) => (
          <HolderCard
            key={`${h.runner.name}@${h.runner.realmSlug}`}
            holder={h}
          />
        ))}
      </ul>
    </div>
  );
}

function HolderCard({ holder }: { holder: SeasonTitleHolder }) {
  const classColor = CLASS_COLOR_VAR[holder.runner.class];
  const s = TIER_STYLE[tierOf(holder)];
  return (
    <li>
      <Link
        href={`/character/${holder.runner.realmSlug}/${encodeURIComponent(
          holder.runner.name,
        )}`}
        className={`${s.shimmer} relative flex items-center gap-3 overflow-hidden rounded-lg border p-3 transition-colors hover:bg-background/60`}
        style={{
          borderColor: `${s.color}66`,
          background: `linear-gradient(180deg, ${s.color}10 0%, transparent 70%)`,
        }}
      >
        {holder.avatarUrl ? (
          <div
            className="relative h-12 w-12 shrink-0 overflow-hidden rounded"
            style={{ border: `2px solid ${s.color}` }}
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
            style={{ border: `2px solid ${s.color}`, color: classColor }}
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
            className={`${s.glow} truncate font-display text-xs font-bold uppercase tracking-widest`}
            style={{ color: s.color }}
          >
            <span className={`${s.star} mr-0.5 inline-block`}>★</span>
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
