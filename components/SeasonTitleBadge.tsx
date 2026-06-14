import type { CharacterSeasonTitle, SeasonTitleTier } from "@/lib/types";

/** Per-tier flair. Gold = top-0.1% "Hero" title (rarest, molten gold).
 *  Silver = top-1% "Champion" achievement (a deliberate step down). */
const TIER_STYLE: Record<
  SeasonTitleTier,
  { color: string; star: string; glow: string; shimmer: string; pct: string }
> = {
  hero: {
    color: "#f4c84b",
    star: "lib-title-star",
    glow: "lib-title-glow",
    shimmer: "lib-title-shimmer",
    pct: "Top 0.1%",
  },
  champion: {
    color: "#c9d4e6",
    star: "lib-title-star-silver",
    glow: "lib-title-glow-silver",
    shimmer: "lib-title-shimmer-silver",
    pct: "Top 1%",
  },
};

/** Legacy data may lack `tier`; treat it as the original Hero tier. */
const tierOf = (t: CharacterSeasonTitle): SeasonTitleTier => t.tier ?? "hero";

/** A single glowing/twinkling ★ with a native hover tooltip naming the
 *  accolade + season. The unit a player "collects" one of per season. Gold for
 *  the Hero title, silver for the Champion achievement. */
function TitleStar({ title }: { title: CharacterSeasonTitle }) {
  const tier = tierOf(title);
  const s = TIER_STYLE[tier];
  return (
    <span
      title={`${title.title} · ${title.season}`}
      aria-label={`Mythic+ seasonal ${
        tier === "hero" ? "title" : "achievement"
      }: ${title.name} (${title.season})`}
      className={`${s.star} inline-flex shrink-0 cursor-help items-center text-sm leading-none`}
      style={{ color: s.color }}
    >
      ★
    </span>
  );
}

/**
 * The Mythic+ end-of-season accolade display. A character collects one star per
 * season (the highest tier they reached — Hero supersedes Champion for a given
 * season), so this renders a ROW of stars. Sizes:
 *   - "stars" : just the star row — sits under the roster card's class line.
 *   - "full"  : the newest accolade as a shimmering pill, plus the full
 *               collection of stars beneath it — character page.
 * Renders nothing when the character holds no accolades.
 */
export function SeasonTitleBadge({
  titles,
  size = "stars",
}: {
  titles?: CharacterSeasonTitle[];
  /** "stars": star row with its own top margin (roster card class line).
   *  "inline": same stars, no margin — for sharing a flex row with other
   *  accolades (the merged Top Performers line). "full": shimmering pill +
   *  collection (character page). */
  size?: "stars" | "inline" | "full";
}) {
  if (!titles || titles.length === 0) return null;
  const newest = titles[0]; // detection + overrides return newest-first
  const s = TIER_STYLE[tierOf(newest)];

  if (size === "stars" || size === "inline") {
    return (
      <span
        className={`flex flex-wrap items-center gap-1${
          size === "stars" ? " mt-1" : ""
        }`}
      >
        {titles.map((t) => (
          <TitleStar key={t.season} title={t} />
        ))}
      </span>
    );
  }

  return (
    <div
      className={`${s.shimmer} relative overflow-hidden rounded-lg border px-4 py-3`}
      style={{
        borderColor: s.color,
        background: `linear-gradient(180deg, ${s.color}29 0%, ${s.color}08 100%)`,
      }}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`${s.star} text-2xl leading-none`}
          style={{ color: s.color }}
        >
          ★
        </span>
        <div className="min-w-0">
          <p
            className={`${s.glow} font-display text-sm font-bold uppercase tracking-widest`}
            style={{ color: s.color }}
          >
            {newest.title}
          </p>
          <p className="truncate text-[11px] text-muted">
            {s.pct} Mythic+ · {newest.season}
          </p>
        </div>
      </div>

      {titles.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <span className="font-display text-[10px] uppercase tracking-widest text-muted">
            {titles.length} titles
          </span>
          {titles.map((t) => (
            <TitleStar key={t.season} title={t} />
          ))}
        </div>
      )}
    </div>
  );
}
