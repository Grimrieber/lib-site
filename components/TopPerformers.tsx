import Image from "next/image";
import Link from "next/link";
import {
  CLASS_COLOR_VAR,
  CLASS_LABEL,
  type Character,
  type RaidTierBadges,
  type Role,
  type WowClass,
} from "@/lib/types";

/**
 * Spec name for a given class+role. For tank and healer columns we always
 * have an unambiguous spec (each class has exactly one), so we override
 * whatever active spec RIO last reported. For DPS, classes often have
 * multiple specs — we keep the active spec since we don't know which DPS
 * spec they actually ran the keys with.
 */
const ROLE_SPEC_BY_CLASS: Record<WowClass, Partial<Record<Role, string>>> = {
  deathknight: { tank: "Blood" },
  demonhunter: { tank: "Vengeance" },
  druid: { tank: "Guardian", healer: "Restoration" },
  evoker: { healer: "Preservation" },
  hunter: {},
  mage: {},
  monk: { tank: "Brewmaster", healer: "Mistweaver" },
  paladin: { tank: "Protection", healer: "Holy" },
  priest: { healer: "Holy" },
  rogue: {},
  shaman: { healer: "Restoration" },
  warlock: {},
  warrior: { tank: "Protection" },
};

function specForRole(c: Character, role: Role): string {
  if (c.role === role) return c.spec;
  return ROLE_SPEC_BY_CLASS[c.class]?.[role] ?? c.spec;
}

export function TopPerformers({ roster }: { roster: Character[] }) {
  const dps = topByRole(roster, "dps", 3);
  const tanks = topByRole(roster, "tank", 3);
  const healers = topByRole(roster, "healer", 3);

  if (!dps.length && !tanks.length && !healers.length) return null;

  return (
    <section className="border-b border-border bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        <p
          className="font-display text-xs uppercase tracking-[0.4em]"
          style={{ color: "var(--faction-fg)" }}
        >
          Guild Leaders
        </p>
        <h2 className="mt-2 font-display text-3xl font-semibold">
          Top Performers
        </h2>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <RoleColumn label="DPS" role="dps" entries={dps} />
          <RoleColumn label="Tanks" role="tank" entries={tanks} />
          <RoleColumn label="Healers" role="healer" entries={healers} />
        </div>
      </div>
    </section>
  );
}

function RoleColumn({
  label,
  role,
  entries,
}: {
  label: string;
  role: Role;
  entries: Character[];
}) {
  if (!entries.length) {
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        <p
          className="font-display text-xs uppercase tracking-widest"
          style={{ color: "var(--faction-fg)" }}
        >
          {label}
        </p>
        <p className="mt-3 text-sm text-muted">No active {label.toLowerCase()} on the roster.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p
        className="font-display text-xs uppercase tracking-widest"
        style={{ color: "var(--faction-fg)" }}
      >
        {label}
      </p>
      <ol className="mt-3 space-y-2">
        {entries.map((c, i) => (
          <PerformerRow
            key={`${c.realm}-${c.name}`}
            character={c}
            role={role}
            place={i + 1}
          />
        ))}
      </ol>
    </div>
  );
}

function PerformerRow({
  character: c,
  role,
  place,
}: {
  character: Character;
  role: Role;
  place: number;
}) {
  const classColor = CLASS_COLOR_VAR[c.class];
  const specLabel = specForRole(c, role);
  const roleScore = c.roleScores?.[role] ?? c.mythicPlusScore ?? null;
  return (
    <li>
      <Link
        href={`/character/${c.realmSlug}/${encodeURIComponent(c.name)}`}
        className="flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-surface"
      >
        <span className="w-5 shrink-0 font-display text-sm tabular-nums text-muted">
          {place}
        </span>
        {c.avatarUrl ? (
          <div
            className="relative h-9 w-9 shrink-0 overflow-hidden rounded"
            style={{ border: `1px solid ${classColor}` }}
          >
            <Image
              src={c.avatarUrl}
              alt={c.name}
              fill
              sizes="36px"
              className="object-cover"
            unoptimized
            />
          </div>
        ) : (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded font-display text-sm font-bold"
            style={{ border: `1px solid ${classColor}`, color: classColor }}
          >
            {c.name[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p
              className="truncate font-display text-sm font-semibold leading-tight"
              style={{ color: classColor }}
            >
              {c.name}
            </p>
            <TierPips badges={c.tierBadges} />
          </div>
          <p className="truncate text-[10px] uppercase tracking-widest text-muted">
            {specLabel} {CLASS_LABEL[c.class]}
          </p>
        </div>
        <span
          className="shrink-0 font-display text-base font-bold tabular-nums"
          style={c.mythicPlusScoreColor ? { color: c.mythicPlusScoreColor } : undefined}
        >
          {roleScore != null
            ? Math.round(roleScore).toLocaleString()
            : "—"}
        </span>
      </Link>
    </li>
  );
}

/**
 * Compact prestige indicators next to the character name. Green = AOTC,
 * orange = Cutting Edge, gold = Hall of Fame. Color signals do the work in
 * the row layout; full labels live on the character page header.
 */
function TierPips({ badges }: { badges?: RaidTierBadges }) {
  if (!badges) return null;
  const pips: { key: string; color: string; label: string }[] = [];
  if (badges.aotc)
    pips.push({ key: "aotc", color: "#22c55e", label: "Ahead of the Curve" });
  if (badges.ce)
    pips.push({ key: "ce", color: "#f97316", label: "Cutting Edge" });
  if (badges.hof)
    pips.push({ key: "hof", color: "#facc15", label: "Hall of Fame" });
  if (!pips.length) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {pips.map((p) => (
        <span
          key={p.key}
          title={p.label}
          aria-label={p.label}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: p.color }}
        />
      ))}
    </span>
  );
}

function topByRole(roster: Character[], role: Role, n: number): Character[] {
  // Bucket each character into the role they scored highest in this season,
  // not the role they're currently flagged as. A tank-main who logged out as
  // their DPS off-spec still belongs on the Tanks board.
  return roster
    .filter((c) => bestRole(c) === role)
    .filter((c) => c.roleScores[role] > 0)
    .sort((a, b) => b.roleScores[role] - a.roleScores[role])
    .slice(0, n);
}

function bestRole(c: Character): Role {
  const { tank, healer, dps } = c.roleScores;
  if (tank >= healer && tank >= dps && tank > 0) return "tank";
  if (healer >= dps && healer > 0) return "healer";
  if (dps > 0) return "dps";
  return c.role;
}
