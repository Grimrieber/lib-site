"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { preferredRole, preferredSpec } from "@/lib/specs";
import { SeasonTitleBadge } from "./SeasonTitleBadge";
import { TierBadges } from "./character/TierBadges";
import {
  CLASS_COLOR_VAR,
  CLASS_LABEL,
  type Character,
  type Role,
} from "@/lib/types";

type RoleFilter = Role | "all";

const ROLES: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "tank", label: "Tanks" },
  { value: "healer", label: "Healers" },
  { value: "dps", label: "DPS" },
];

export function RosterGrid({ roster }: { roster: Character[] }) {
  const [role, setRole] = useState<RoleFilter>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roster.filter((c) => {
      // Bucket by preferred role (highest M+ score split, honoring
      // roleOverride) — matches the spec label shown on the card and the
      // Top Performers board on the homepage. Reading raw c.role would
      // mis-bucket players who logged out in an off-spec.
      if (role !== "all" && preferredRole(c) !== role) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [roster, role, search]);

  const sorted = useMemo(() => {
    // Three-tier pin: leaders first, then officers, then everyone else by
    // M+ score. The snapshot already stamps isGuildLeader and isOfficer
    // (mutually exclusive), so we just bucket and sort within each tier.
    const leaderTop: Character[] = [];
    const officerTop: Character[] = [];
    const rest: Character[] = [];
    for (const c of filtered) {
      if (c.isGuildLeader) leaderTop.push(c);
      else if (c.isOfficer) officerTop.push(c);
      else rest.push(c);
    }

    const byScore = (a: Character, b: Character) => {
      const sa = a.mythicPlusScore ?? 0;
      const sb = b.mythicPlusScore ?? 0;
      if (sa !== sb) return sb - sa;
      return a.name.localeCompare(b.name);
    };
    leaderTop.sort(byScore);
    officerTop.sort(byScore);
    rest.sort(byScore);

    return [...leaderTop, ...officerTop, ...rest];
  }, [filtered]);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-md border border-border bg-surface p-1">
          {ROLES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRole(r.value)}
              className={`rounded px-3 py-1.5 font-display text-xs uppercase tracking-widest transition-colors ${
                role === r.value
                  ? "text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
              style={
                role === r.value
                  ? { background: "var(--faction)" }
                  : undefined
              }
            >
              {r.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-faction focus:outline-none sm:w-64"
        />
      </div>

      <p className="mt-4 text-xs text-muted">
        {sorted.length} {sorted.length === 1 ? "raider" : "raiders"}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((c) => (
          <CharacterCard key={`${c.realm}-${c.name}`} character={c} />
        ))}
      </div>
    </div>
  );
}

function CharacterCard({ character: c }: { character: Character }) {
  const classColor = CLASS_COLOR_VAR[c.class];
  const factionColor =
    c.faction === "alliance" ? "var(--color-alliance)" : "var(--color-horde)";
  // "Guild Leader" wins over everything — active mains of the co-leaders.
  // "Officer" is next, for the OFFICER_RANK_THRESHOLD tier. Falls back to
  // a custom RANK_LABELS entry if one is configured. We deliberately do
  // NOT show a "GM" badge based on rankNumber === 0 alone, because the
  // parked alt sometimes holds the rank-0 slot in this guild.
  const rankBadgeText = c.isGuildLeader
    ? "Guild Leader"
    : c.isOfficer
      ? "Officer"
      : c.rankLabel ?? null;
  const showRankBadge = !!rankBadgeText;
  const externalRealm = c.realm.toLowerCase() !== "skullcrusher";
  // "Active this week" — within the last 7 days. Uses lastRunAt (most recent
  // M+ key timestamp) which the snapshot stamps on every active character.
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const activeThisWeek =
    !!c.lastRunAt && Date.now() - c.lastRunAt < ONE_WEEK_MS;

  return (
    <article
      className="relative overflow-hidden rounded-lg border border-border bg-surface p-4"
      style={{ borderLeft: `3px solid ${factionColor}` }}
    >
      <div className="flex gap-4">
        <Avatar character={c} classColor={classColor} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {activeThisWeek && (
                  <span
                    aria-label="Active this week"
                    title="Active this week — M+ run within last 7 days"
                    className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse"
                  />
                )}
                <h3
                  className="min-w-0 truncate font-display text-xl font-semibold leading-tight"
                  style={{ color: classColor }}
                >
                  <Link
                    href={`/character/${c.realmSlug}/${encodeURIComponent(c.name)}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {c.name}
                  </Link>
                </h3>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">
                {preferredSpec(c)} {CLASS_LABEL[c.class]}
                {externalRealm && (
                  <span className="text-muted/70"> · {c.realm}</span>
                )}
              </p>
              {(c.tierBadges || (c.seasonTitles?.length ?? 0) > 0) && (
                // Merged accolade line — raid pills + season stars on one row,
                // matching the Top Performers treatment.
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {c.tierBadges && <TierBadges badges={c.tierBadges} />}
                  <SeasonTitleBadge titles={c.seasonTitles} size="inline" />
                </div>
              )}
            </div>
            {showRankBadge && (
              <span
                className="shrink-0 rounded border px-2 py-0.5 font-display text-[10px] uppercase tracking-widest text-muted"
                style={{ borderColor: factionColor }}
              >
                {rankBadgeText}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats row spans the full card width. Grid columns are weighted
          so the Peak / Equip iLvl cell gets ~2x the room of M+ and Role
          — three-decimal ilvl pairs like "290.813 / 290.813" are ~17
          chars and need the space to stay on one line. */}
      <div className="mt-3 grid grid-cols-[2fr_1fr_1fr] gap-2 border-t border-border pt-3">
        <IlvlStat
          peak={c.peakIlvl ?? c.ilvl}
          equipped={c.ilvl}
        />
        <Stat
          label="M+"
          value={
            c.mythicPlusScore != null && c.mythicPlusScore > 0
              ? Math.round(c.mythicPlusScore).toLocaleString()
              : "—"
          }
          color={c.mythicPlusScoreColor}
        />
        <Stat
          label="Role"
          value={(() => {
            const r = preferredRole(c);
            return r === "dps" ? "DPS" : r === "tank" ? "Tank" : "Heal";
          })()}
        />
      </div>
    </article>
  );
}

function Avatar({
  character,
  classColor,
}: {
  character: Character;
  classColor: string;
}) {
  if (!character.avatarUrl) {
    return (
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded font-display text-lg font-bold"
        style={{
          background: "var(--bg)",
          border: `2px solid ${classColor}`,
          color: classColor,
        }}
      >
        {character.name[0]?.toUpperCase()}
      </div>
    );
  }
  return (
    <div
      className="relative h-14 w-14 shrink-0 overflow-hidden rounded"
      style={{ border: `2px solid ${classColor}` }}
    >
      <Image
        src={character.avatarUrl}
        alt={character.name}
        fill
        sizes="56px"
        className="object-cover"
      unoptimized
      />
    </div>
  );
}

/** Up to 3 decimals, trailing zeros stripped — matches the home page Top
 *  iLvl panel. Roster cards are narrow but the full decimal precision is
 *  worth showing so a player can spot the difference between 290.5 and
 *  290.75 at a glance. */
function formatIlvlForCard(v: number | undefined): string {
  if (v == null) return "—";
  return String(parseFloat(v.toFixed(3)));
}

/** Single concatenated "peak / equipped" iLvl cell. Always shows both
 *  numbers so a player can spot at a glance whether a character is in
 *  their best loadout right now or sitting on PvP / leveling gear. */
function IlvlStat({
  peak,
  equipped,
}: {
  peak: number | undefined;
  equipped: number | undefined;
}) {
  return (
    <div>
      <p className="font-display text-[9px] uppercase tracking-widest text-muted">
        Peak / Equip iLvl
      </p>
      <p className="mt-0.5 whitespace-nowrap font-display text-base font-semibold tabular-nums">
        {formatIlvlForCard(peak)} / {formatIlvlForCard(equipped)}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div>
      <p className="font-display text-[9px] uppercase tracking-widest text-muted">
        {label}
      </p>
      <p
        className="mt-0.5 font-display text-base font-semibold"
        style={color ? { color } : undefined}
      >
        {value}
      </p>
    </div>
  );
}
