import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { GUILD } from "@/lib/config";
import { formatCstDateTime } from "@/lib/cst";
import { CLASS_COLOR_VAR, CLASS_LABEL, type Character } from "@/lib/types";

/**
 * "Who's on track" board for the end-of-season Mythic+ accolades, shown UNTIL
 * Blizzard awards them at season end (when the real silver/gold stars take over
 * via parseSeasonTitle on the roster cards + Top Performers). The two tiers:
 *   - Hero     = top 0.1% (gold)   -> RIO cutoff `p999`  (seasonal TITLE)
 *   - Champion = top 1%  (silver)  -> RIO cutoff `p990`  (achievement + mount)
 * Cutoffs pulled LIVE from Raider.IO, region-wide / all-factions.
 *
 * Fully data-driven — nothing is hardcoded to a season. The SEASON is passed in
 * (from `snapshot.currentSeasonSlug`) so it auto-rolls every season, and the
 * season's title ADJECTIVE (e.g. "Umbral") is filled in from the site's own
 * detected titles once anyone's earned one; until then it shows plain
 * "Hero"/"Champion". So no per-season edit is ever needed.
 */

const FACTION: "alliance" | "horde" | "all" = "all"; // region-wide; cutoff isn't faction-split
const BUBBLE = 100; // "within 100 rating" of the top-1% line
const HERO_COLOR = "#e8c15a"; // gold — top 0.1%
const CHAMP_COLOR = "#c4c8d0"; // silver — top 1%

type Tier = "hero" | "champion" | "bubble";
type Tracked = { c: Character; score: number; tier: Tier };
export type SeasonWatch = {
  champion: number;
  hero: number;
  updatedAt: string | null;
  rows: Tracked[];
};

// Wrapped in unstable_cache so the home page stays STATICALLY prerendered (no
// per-request no-store fetch forcing it dynamic — the prod-safety lesson from
// the precompute incident). Refreshes hourly, in step with the page's revalidate.
const getSeasonCutoffs = unstable_cache(
  async (
    seasonSlug: string,
  ): Promise<{
    champion: number | null;
    hero: number | null;
    updatedAt: string | null;
  } | null> => {
    try {
      const res = await fetch(
        `https://raider.io/api/v1/mythic-plus/season-cutoffs?season=${seasonSlug}&region=${GUILD.region.toLowerCase()}`,
      );
      if (!res.ok) return null;
      const c = (await res.json())?.cutoffs;
      const pick = (p: string) => c?.[p]?.[FACTION]?.quantileMinValue ?? null;
      return { champion: pick("p990"), hero: pick("p999"), updatedAt: c?.updatedAt ?? null };
    } catch {
      return null;
    }
  },
  // seasonSlug is folded into the cache key by unstable_cache, so each season
  // caches separately and a rollover can't serve the prior season's cutoffs.
  ["lib-season-cutoffs-v2"],
  { revalidate: 3600 },
);

function classify(roster: Character[], champion: number, hero: number): Tracked[] {
  return roster
    .map((c) => ({ c, score: c.mythicPlusScore ?? 0 }))
    .filter((x) => x.score >= champion - BUBBLE)
    .map(({ c, score }): Tracked => ({
      c,
      score,
      tier: score >= hero ? "hero" : score >= champion ? "champion" : "bubble",
    }))
    .sort((a, b) => b.score - a.score);
}

/** Fetch cutoffs + classify the roster. Returns null when RIO is unavailable or
 *  the cutoffs aren't published yet. */
export async function getSeasonWatch(
  roster: Character[],
  seasonSlug: string | undefined,
): Promise<SeasonWatch | null> {
  if (!seasonSlug) return null; // no known current season → nothing to watch
  const cutoffs = await getSeasonCutoffs(seasonSlug);
  if (!cutoffs || cutoffs.champion == null || cutoffs.hero == null) return null;
  return {
    champion: cutoffs.champion,
    hero: cutoffs.hero,
    updatedAt: cutoffs.updatedAt,
    rows: classify(roster, cutoffs.champion, cutoffs.hero),
  };
}

export function SeasonEndWatch({
  watch,
  adjective,
}: {
  watch: SeasonWatch;
  /** The season's title adjective (e.g. "Umbral"), sourced from the site's own
   *  detected titles once anyone's earned one this season. Undefined
   *  early-season → plain "Hero"/"Champion" labels. Never hardcoded. */
  adjective?: string;
}) {
  const heroLabel = `${adjective ? `${adjective} ` : ""}Hero`;
  const champLabel = `${adjective ? `${adjective} ` : ""}Champion`;
  return (
    <section className="border-b border-border bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        <h2 className="font-display text-3xl font-semibold">Season-End Watch</h2>
        <p className="mt-1.5 text-xs text-muted">
          On track for the season&apos;s Mythic+ titles — live rating vs Raider.IO&apos;s
          region-wide cutoffs, provisional until awarded at season end.
        </p>

        <div className="mt-6 rounded-lg border border-border bg-background p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border pb-4">
            <Legend color={HERO_COLOR} label={heroLabel} sub="top 0.1%" cutoff={watch.hero} />
            <Legend
              color={CHAMP_COLOR}
              label={champLabel}
              sub="top 1%"
              cutoff={watch.champion}
            />
            {watch.updatedAt ? (
              <span className="ml-auto text-[10px] text-muted/70">
                live · updated {formatCstDateTime(watch.updatedAt)}
              </span>
            ) : null}
          </div>

          {watch.rows.length === 0 ? (
            <p className="mt-4 text-sm italic text-muted">
              Nobody&apos;s within {BUBBLE} of the top-1% line yet.
            </p>
          ) : (
            <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {watch.rows.map((t, i) => (
                <Row
                  key={t.c.realmSlug + t.c.name}
                  t={t}
                  place={i + 1}
                  champion={watch.champion}
                  hero={watch.hero}
                  heroLabel={heroLabel}
                  champLabel={champLabel}
                />
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

function Legend({
  color,
  label,
  sub,
  cutoff,
}: {
  color: string;
  label: string;
  sub: string;
  cutoff: number;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span aria-hidden style={{ color }}>
        ★
      </span>
      <span className="font-display text-sm font-semibold" style={{ color }}>
        {label}
      </span>
      <span className="text-[11px] uppercase tracking-widest text-muted">
        {sub} · {Math.round(cutoff)}
      </span>
    </span>
  );
}

function Row({
  t,
  place,
  champion,
  hero,
  heroLabel,
  champLabel,
}: {
  t: Tracked;
  place: number;
  champion: number;
  hero: number;
  heroLabel: string;
  champLabel: string;
}) {
  const classColor = CLASS_COLOR_VAR[t.c.class];
  const tierColor = t.tier === "hero" ? HERO_COLOR : t.tier === "champion" ? CHAMP_COLOR : undefined;

  let status: { text: string; color: string };
  if (t.tier === "hero") {
    status = { text: `${heroLabel} · top 0.1%`, color: HERO_COLOR };
  } else if (t.tier === "champion") {
    status = { text: `${champLabel} · ${Math.round(hero - t.score)} to Hero`, color: CHAMP_COLOR };
  } else {
    status = { text: `${Math.round(champion - t.score)} to Champion`, color: "var(--color-muted)" };
  }

  return (
    <li>
      <Link
        href={`/character/${t.c.realmSlug}/${encodeURIComponent(t.c.name)}`}
        className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-surface"
      >
      <span className="w-5 shrink-0 text-center font-display text-sm leading-none">
        {tierColor ? (
          <span aria-hidden style={{ color: tierColor }}>
            ★
          </span>
        ) : (
          <span className="tabular-nums text-muted">{place}</span>
        )}
      </span>
      {t.c.avatarUrl ? (
        <Image
          src={t.c.avatarUrl}
          alt=""
          width={32}
          height={32}
          unoptimized
          className="h-8 w-8 shrink-0 rounded"
          style={{ border: `1px solid ${classColor}` }}
        />
      ) : (
        <span
          className="h-8 w-8 shrink-0 rounded"
          style={{ border: `1px solid ${classColor}`, background: "var(--color-surface)" }}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-semibold" style={{ color: classColor }}>
          {t.c.name}
        </p>
        <p className="truncate text-[10px] uppercase tracking-widest text-muted">
          {t.c.spec} {CLASS_LABEL[t.c.class]}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span className="font-display text-base font-bold tabular-nums">
          {Math.round(t.score)}
        </span>
        <span className="text-[10px] font-semibold tabular-nums" style={{ color: status.color }}>
          {status.text}
        </span>
      </div>
      </Link>
    </li>
  );
}
