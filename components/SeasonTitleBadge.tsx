import type { CharacterSeasonTitle } from "@/lib/types";

/** Gold shared by every season-title surface — the top-0.1% "Hero" title is
 *  the rarest flair on the site, so it reads as molten gold. */
const TITLE_GOLD = "#f4c84b";

/** A single glowing/twinkling gold ★ with a native hover tooltip naming the
 *  title + season. The unit a player "collects" one of per season. */
function TitleStar({ title }: { title: CharacterSeasonTitle }) {
  return (
    <span
      title={`${title.title} · ${title.season}`}
      aria-label={`Mythic+ seasonal title: ${title.name} (${title.season})`}
      className="lib-title-star inline-flex shrink-0 cursor-help items-center text-sm leading-none"
      style={{ color: TITLE_GOLD }}
    >
      ★
    </span>
  );
}

/**
 * The Mythic+ seasonal "Hero" title display (top 0.1%). A character collects
 * one title per season, so this renders a ROW of stars. Sizes:
 *   - "stars" : just the star row — sits under the roster card's class line.
 *   - "full"  : the newest title as a shimmering gold pill, plus the full
 *               collection of stars beneath it — character page.
 * Renders nothing when the character holds no titles.
 */
export function SeasonTitleBadge({
  titles,
  size = "stars",
}: {
  titles?: CharacterSeasonTitle[];
  size?: "stars" | "full";
}) {
  if (!titles || titles.length === 0) return null;
  const newest = titles[0]; // detection + overrides return newest-first

  if (size === "stars") {
    return (
      <span className="mt-1 flex flex-wrap items-center gap-1">
        {titles.map((t) => (
          <TitleStar key={t.season} title={t} />
        ))}
      </span>
    );
  }

  return (
    <div
      className="lib-title-shimmer relative overflow-hidden rounded-lg border px-4 py-3"
      style={{
        borderColor: TITLE_GOLD,
        background:
          "linear-gradient(180deg, rgba(244,200,75,0.16) 0%, rgba(244,200,75,0.03) 100%)",
      }}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="lib-title-star text-2xl leading-none"
          style={{ color: TITLE_GOLD }}
        >
          ★
        </span>
        <div className="min-w-0">
          <p
            className="lib-title-glow font-display text-sm font-bold uppercase tracking-widest"
            style={{ color: TITLE_GOLD }}
          >
            {newest.title}
          </p>
          <p className="truncate text-[11px] text-muted">
            Top 0.1% Mythic+ · {newest.season}
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
