import type { Metadata } from "next";
import { CLASS_COLOR_VAR, CLASS_LABEL, type WowClass } from "@/lib/types";

/**
 * Throwaway design-preview route for the proposed SECOND seasonal tier:
 * "Umbral Champion: Midnight Season One" — the top 1% of the region's M+
 * ladder (judged on FINAL end-of-season standing; rewards an exclusive mount,
 * NOT a title). It sits alongside the existing top-0.1% "Umbral Hero" title.
 *
 * Unlike the first pass, this renders the new tier IN ITS THREE REAL SPOTS —
 * reproduced faithfully from the live components so the look can be judged in
 * context BEFORE wiring detection + the real components:
 *   1. Roster card star row        (RosterGrid.tsx CharacterCard)
 *   2. Character-page hero pill     (Profile.tsx, SeasonTitleBadge size="full")
 *   3. Home-page holder section     (SeasonTitleHighlight.tsx, app/page.tsx)
 *
 * Design call: Hero stays molten GOLD (rarest); Champion is SILVER — a
 * deliberate step down so the 0.1% star keeps its weight. Not linked from nav;
 * noindex. Self-contained (mock data + inlined faithful copies), so production
 * is untouched. Delete once the tier design is signed off.
 *
 * View at: /title-tiers-preview
 */

export const metadata: Metadata = {
  title: "Seasonal Title Tiers — Preview",
  robots: { index: false, follow: false },
};

const SEASON = "Midnight Season One";

/* ------------------------------------------------------------------ */
/* Tier config                                                        */
/* ------------------------------------------------------------------ */

type Tier = {
  key: "hero" | "champion";
  color: string;
  /** translucent rgba prefix, e.g. "rgba(244,200,75," — caller closes it. */
  fill: string;
  star: string; // animation class
  glow: string;
  shimmer: string;
  pct: string;
  /** What the badge LABELS itself as. Hero is a real title; Champion is a
   *  season-end achievement, so it reads as the achievement name, not "the …". */
  label: string;
  /** Tooltip / context sub-line. */
  sub: string;
  /** Short kind word shown on the home section subhead. */
  kind: string;
};

const HERO: Tier = {
  key: "hero",
  color: "#f4c84b",
  fill: "rgba(244,200,75,",
  star: "lib-title-star",
  glow: "lib-title-glow",
  shimmer: "lib-title-shimmer",
  pct: "Top 0.1%",
  label: "the Umbral Hero",
  sub: "Top 0.1% Mythic+ · " + SEASON,
  kind: "the title goes to the top 0.1% of the region",
};

const CHAMPION: Tier = {
  key: "champion",
  color: "#c9d4e6",
  fill: "rgba(201,212,230,",
  star: "demo-title-star-silver",
  glow: "demo-title-glow-silver",
  shimmer: "demo-title-shimmer-silver",
  pct: "Top 1%",
  label: "Umbral Champion",
  sub: "Top 1% Mythic+ · season end · " + SEASON,
  kind: "the top 1% of the region at season's end",
};

type Holder = {
  name: string;
  wowClass: WowClass;
  score: number;
  /** Which tiers this character holds, gold-first. */
  tiers: Tier[];
};

const HERO_HOLDERS: Holder[] = [
  { name: "Grimcleave", wowClass: "warrior", score: 3984, tiers: [HERO] },
  { name: "Voidbloom", wowClass: "warlock", score: 3911, tiers: [HERO] },
];

const CHAMPION_HOLDERS: Holder[] = [
  { name: "Kujatas", wowClass: "shaman", score: 3602, tiers: [CHAMPION] },
  { name: "Hexwright", wowClass: "mage", score: 3571, tiers: [CHAMPION] },
  { name: "Palerot", wowClass: "priest", score: 3540, tiers: [CHAMPION] },
  { name: "Snareling", wowClass: "hunter", score: 3508, tiers: [CHAMPION] },
];

/* ------------------------------------------------------------------ */
/* Shared atoms                                                        */
/* ------------------------------------------------------------------ */

/** Faithful copy of SeasonTitleBadge's TitleStar, tier-colored. */
function Star({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span
      title={`${tier.label} · ${SEASON}`}
      aria-label={`Mythic+ seasonal ${tier.key === "hero" ? "title" : "achievement"}: ${tier.label} (${SEASON})`}
      className={`${tier.star} inline-flex shrink-0 cursor-help items-center leading-none ${className ?? ""}`}
      style={{ color: tier.color }}
    >
      ★
    </span>
  );
}

function InitialAvatar({
  holder,
  ring,
  size,
}: {
  holder: Holder;
  ring: string;
  size: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded font-display font-bold"
      style={{
        height: size,
        width: size,
        background: "var(--bg)",
        border: `2px solid ${ring}`,
        color: CLASS_COLOR_VAR[holder.wowClass],
        fontSize: size * 0.34,
      }}
    >
      {holder.name[0]?.toUpperCase()}
    </div>
  );
}

/* ================================================================== */
/* SPOT 1 — Roster card (faithful copy of RosterGrid CharacterCard)   */
/* ================================================================== */

function RosterCard({ holder }: { holder: Holder }) {
  const classColor = CLASS_COLOR_VAR[holder.wowClass];
  const factionColor = "var(--color-alliance)";
  return (
    <article
      className="group relative overflow-hidden rounded-lg border border-border bg-surface p-4"
      style={{ borderLeft: `3px solid ${factionColor}` }}
    >
      <div className="flex gap-4">
        <InitialAvatar holder={holder} ring={classColor} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  aria-label="Active this week"
                  className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-400"
                />
                <h3
                  className="truncate font-display text-xl font-semibold leading-tight"
                  style={{ color: classColor }}
                >
                  {holder.name}
                </h3>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">
                {CLASS_LABEL[holder.wowClass]}
              </p>
              {/* SeasonTitleBadge size="stars" — the star row */}
              <span className="mt-1 flex flex-wrap items-center gap-1">
                {holder.tiers.map((t) => (
                  <Star key={t.key} tier={t} className="text-sm" />
                ))}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[2fr_1fr_1fr] gap-2 border-t border-border pt-3">
        <div>
          <p className="font-display text-[9px] uppercase tracking-widest text-muted">
            Peak / Equip iLvl
          </p>
          <p className="mt-0.5 whitespace-nowrap font-display text-base font-semibold tabular-nums">
            301 / 301
          </p>
        </div>
        <div>
          <p className="font-display text-[9px] uppercase tracking-widest text-muted">
            M+
          </p>
          <p className="mt-0.5 font-display text-base font-semibold">
            {holder.score.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="font-display text-[9px] uppercase tracking-widest text-muted">
            Role
          </p>
          <p className="mt-0.5 font-display text-base font-semibold">DPS</p>
        </div>
      </div>
    </article>
  );
}

/* ================================================================== */
/* SPOT 2 — Character-page hero pill (SeasonTitleBadge size="full")    */
/* ================================================================== */

function FullPill({ tier }: { tier: Tier }) {
  return (
    <div
      className={`${tier.shimmer} relative overflow-hidden rounded-lg border px-4 py-3`}
      style={{
        borderColor: tier.color,
        background: `linear-gradient(180deg, ${tier.fill}0.16) 0%, ${tier.fill}0.03) 100%)`,
      }}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`${tier.star} text-2xl leading-none`}
          style={{ color: tier.color }}
        >
          ★
        </span>
        <div className="min-w-0">
          <p
            className={`${tier.glow} font-display text-sm font-bold uppercase tracking-widest`}
            style={{ color: tier.color }}
          >
            {tier.label}
          </p>
          <p className="truncate text-[11px] text-muted">{tier.sub}</p>
        </div>
      </div>
    </div>
  );
}

/** A character-page hero panel holding BOTH tier pills, as Profile.tsx would
 *  stack them (newest/highest first). */
function CharacterHero({ holder }: { holder: Holder }) {
  const classColor = CLASS_COLOR_VAR[holder.wowClass];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="relative p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-4">
          <InitialAvatar holder={holder} ring={classColor} size={72} />
          <div>
            <h3
              className="font-display text-3xl font-semibold"
              style={{ color: classColor }}
            >
              {holder.name}
            </h3>
            <p className="text-sm text-muted">
              {CLASS_LABEL[holder.wowClass]} · Skullcrusher
            </p>
          </div>
        </div>
        {/* SeasonTitleBadge size="full" spot — one pill per tier held */}
        <div className="mb-4 space-y-2">
          {holder.tiers.map((t) => (
            <FullPill key={t.key} tier={t} />
          ))}
        </div>
        <div className="rounded-lg border border-dashed border-border/60 p-3 text-center text-[11px] text-muted">
          (rest of character profile — gear, talents, raids…)
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* SPOT 3 — Home-page section (SeasonTitleHighlight)                   */
/* ================================================================== */

function HolderCard({ holder }: { holder: Holder }) {
  const tier = holder.tiers[0];
  const classColor = CLASS_COLOR_VAR[holder.wowClass];
  return (
    <li>
      <div
        className={`${tier.shimmer} relative flex items-center gap-3 overflow-hidden rounded-lg border p-3`}
        style={{
          borderColor: `${tier.color}66`,
          background: `linear-gradient(180deg, ${tier.fill}0.06) 0%, transparent 70%)`,
        }}
      >
        <InitialAvatar holder={holder} ring={tier.color} size={48} />
        <div className="min-w-0">
          <p
            className="truncate font-display text-lg font-semibold leading-tight"
            style={{ color: classColor }}
          >
            {holder.name}
          </p>
          <p
            className={`${tier.glow} truncate font-display text-xs font-bold uppercase tracking-widest`}
            style={{ color: tier.color }}
          >
            <span className={`${tier.star} mr-0.5 inline-block`}>★</span>
            {tier.label}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {holder.score.toLocaleString()} M+ score
          </p>
        </div>
      </div>
    </li>
  );
}

/** The home-page section as it would read with both tiers: the gold Hero
 *  headline (unchanged) plus a silver Champion sub-tier beneath a divider. */
function HomeSection() {
  return (
    <section
      className="border-y border-border"
      style={{
        background:
          "linear-gradient(180deg, rgba(244,200,75,0.07) 0%, transparent 60%)",
      }}
    >
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        {/* Hero (top 0.1%) — unchanged headline */}
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p
              className={`${HERO.glow} font-display text-xs uppercase tracking-[0.4em]`}
              style={{ color: HERO.color }}
            >
              ★ {HERO.pct}
            </p>
            <h2 className="mt-2 font-display text-3xl font-semibold">
              Mythic+ Title Holders
            </h2>
          </div>
          <p className="text-xs text-muted">
            {SEASON} · {HERO.kind}
          </p>
        </div>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {HERO_HOLDERS.map((h) => (
            <HolderCard key={h.name} holder={h} />
          ))}
        </ul>

        {/* Champion (top 1%) — silver sub-tier */}
        <div className="mt-10 border-t border-border/60 pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p
                className={`${CHAMPION.glow} font-display text-xs uppercase tracking-[0.4em]`}
                style={{ color: CHAMPION.color }}
              >
                ★ {CHAMPION.pct}
              </p>
              <h3 className="mt-2 font-display text-2xl font-semibold">
                Umbral Champions
              </h3>
            </div>
            <p className="text-xs text-muted">
              {SEASON} · {CHAMPION.kind}
            </p>
          </div>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CHAMPION_HOLDERS.map((h) => (
              <HolderCard key={h.name} holder={h} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

function SpotLabel({ n, title, where }: { n: number; title: string; where: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <span className="font-display text-xs uppercase tracking-[0.3em] text-muted">
        Spot {n}
      </span>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <span className="text-[11px] text-muted">{where}</span>
    </div>
  );
}

export default function TitleTiersPreviewPage() {
  // The character holding BOTH tiers, to show stacking in spots 1 & 2.
  const dualHolder: Holder = {
    name: "Duskmaw",
    wowClass: "demonhunter",
    score: 3700,
    tiers: [HERO, CHAMPION],
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <style dangerouslySetInnerHTML={{ __html: SILVER_CSS }} />

      <header className="border-b border-border pb-6">
        <p className="font-display text-xs uppercase tracking-[0.4em] text-muted">
          Design preview · not linked · noindex
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold">
          Seasonal Tiers — in their real spots
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Existing <span style={{ color: HERO.color }}>★ the Umbral Hero</span>{" "}
          (top 0.1% title, molten gold) plus the new{" "}
          <span style={{ color: CHAMPION.color }}>★ Umbral Champion</span> (top
          1%, season-end achievement + mount, silver). Each block below is the
          real on-site location, reproduced faithfully.
        </p>
      </header>

      {/* SPOT 1 */}
      <section className="mt-10">
        <SpotLabel n={1} title="Roster card" where="/ roster grid — star row under the class line" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <RosterCard holder={HERO_HOLDERS[0]} />
          <RosterCard holder={CHAMPION_HOLDERS[0]} />
          <RosterCard holder={dualHolder} />
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Third card holds both — gold star first, then silver.
        </p>
      </section>

      {/* SPOT 2 */}
      <section className="mt-12">
        <SpotLabel n={2} title="Character page" where="character hero — full shimmer pill(s)" />
        <div className="max-w-xl">
          <CharacterHero holder={dualHolder} />
        </div>
      </section>

      {/* SPOT 3 */}
      <section className="mt-12">
        <SpotLabel n={3} title="Home page" where="full-width section below the poll" />
        <div className="-mx-4 sm:-mx-6">
          <HomeSection />
        </div>
      </section>
    </main>
  );
}

/* Silver-tier animation variants — mirror the gold .lib-title-* rules from
   globals.css in silver. Scoped to this throwaway page; promote to globals.css
   if the tier ships. */
const SILVER_CSS = `
@keyframes demo-title-star-silver {
  0%, 100% { transform: scale(1) rotate(0deg);   filter: drop-shadow(0 0 3px rgba(201,212,230,0.5)); }
  50%      { transform: scale(1.2) rotate(10deg); filter: drop-shadow(0 0 9px rgba(225,232,244,0.95)); }
}
.demo-title-star-silver {
  display: inline-block;
  transform-origin: center;
  animation: demo-title-star-silver 2.6s ease-in-out infinite;
}
@keyframes demo-title-glow-silver {
  0%, 100% { text-shadow: 0 0 6px rgba(201,212,230,0.4); }
  50%      { text-shadow: 0 0 14px rgba(225,232,244,0.85), 0 0 28px rgba(201,212,230,0.35); }
}
.demo-title-glow-silver { animation: demo-title-glow-silver 2.4s ease-in-out infinite; }
.demo-title-shimmer-silver::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background-image: linear-gradient(100deg, transparent 35%, rgba(225,232,244,0.3) 50%, transparent 65%);
  background-size: 220% 100%;
  background-repeat: no-repeat;
  animation: lib-title-shimmer 3.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .demo-title-star-silver,
  .demo-title-glow-silver { animation: none; }
  .demo-title-shimmer-silver::after { animation: none; opacity: 0; }
}
`;
