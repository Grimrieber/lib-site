import Image from "next/image";
import Link from "next/link";
import { ALT_GROUPS } from "@/lib/config";
import { specForClassRole } from "@/lib/specs";
import {
  CLASS_COLOR_VAR,
  CLASS_LABEL,
  type Character,
  type RaidTierBadges,
  type Role,
} from "@/lib/types";

/** Spec to display in this role's column. */
function specForRole(c: Character, role: Role): string {
  if (c.role === role) return c.spec;
  return specForClassRole(c, role);
}

export function TopPerformers({ roster }: { roster: Character[] }) {
  const dps = topByRole(roster, "dps", 5);
  const tanks = topByRole(roster, "tank", 5);
  const healers = topByRole(roster, "healer", 5);

  if (!dps.length && !tanks.length && !healers.length) return null;

  return (
    <section className="border-b border-border bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        <p
          className="font-display text-xs uppercase tracking-[0.4em]"
          style={{ color: "var(--faction-fg)" }}
        >
          Mythic+ Leaders
        </p>
        <h2 className="mt-2 font-display text-3xl font-semibold">
          Top Performers
        </h2>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <RoleColumn label="DPS" role="dps" groups={dps} />
          <RoleColumn label="Tanks" role="tank" groups={tanks} />
          <RoleColumn label="Healers" role="healer" groups={healers} />
        </div>
      </div>
    </section>
  );
}

function RoleColumn({
  label,
  role,
  groups,
}: {
  label: string;
  role: Role;
  groups: Character[][];
}) {
  if (!groups.length) {
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
        {groups.map((group, i) => (
          <PerformerGroupRow
            key={group[0]!.realmSlug + group[0]!.name}
            group={group}
            role={role}
            place={i + 1}
          />
        ))}
      </ol>
    </div>
  );
}

function PerformerGroupRow({
  group,
  role,
  place,
}: {
  group: Character[];
  role: Role;
  place: number;
}) {
  // group[0] is the player's highest-scoring character (sorted upstream)
  // and gets the slot's main row. Any additional alts collapse behind a
  // "+N alts" toggle that uses native <details> so we stay a server
  // component — keeps the slot compact regardless of how many alts a
  // player has in this role.
  const [primary, ...alts] = group;
  if (!primary) return null;
  // Combined role score across the player's primary + all alts. Shown
  // as a "Total" line at the bottom of the expanded alts panel so a
  // multi-character player's full footprint in this role is visible
  // at a glance.
  const groupTotal = group.reduce(
    (sum, c) => sum + (c.roleScores?.[role] ?? 0),
    0,
  );
  return (
    <li>
      <div className="flex items-start gap-3 rounded-md px-2 py-1.5">
        <span className="mt-1 w-5 shrink-0 font-display text-sm tabular-nums text-muted">
          {place}
        </span>
        <div className="min-w-0 flex-1">
          <PerformerCharacterLink character={primary} role={role} />
          {alts.length > 0 && (
            <details className="mt-1.5">
              <summary className="cursor-pointer pl-1 font-display text-[10px] uppercase tracking-widest text-muted hover:text-foreground">
                +{alts.length} alt{alts.length > 1 ? "s" : ""}
              </summary>
              <div className="mt-1 space-y-1">
                {alts.map((c) => (
                  <PerformerCharacterLink
                    key={c.realmSlug + c.name}
                    character={c}
                    role={role}
                  />
                ))}
                <div className="flex items-center gap-3 border-t border-border/50 pt-1.5">
                  <span className="h-9 w-9 shrink-0" aria-hidden />
                  <p className="flex-1 font-display text-[10px] uppercase tracking-widest text-muted">
                    Total
                  </p>
                  <span className="font-display text-base font-bold tabular-nums">
                    {Math.round(groupTotal).toLocaleString()}
                  </span>
                </div>
              </div>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}

function PerformerCharacterLink({
  character: c,
  role,
}: {
  character: Character;
  role: Role;
}) {
  const classColor = CLASS_COLOR_VAR[c.class];
  const specLabel = specForRole(c, role);
  const roleScore = c.roleScores?.[role] ?? c.mythicPlusScore ?? null;
  return (
    <Link
      href={`/character/${c.realmSlug}/${encodeURIComponent(c.name)}`}
      className="flex items-center gap-3 rounded-md transition-colors hover:bg-surface"
    >
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
        {roleScore != null ? Math.round(roleScore).toLocaleString() : "—"}
      </span>
    </Link>
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

function topByRole(roster: Character[], role: Role, n: number): Character[][] {
  // Bucket each character into the role they scored highest in this season,
  // not the role they're currently flagged as. A tank-main who logged out
  // as their DPS off-spec still belongs on the Tanks board.
  const candidates = roster
    .filter((c) => bestRole(c) === role)
    .filter((c) => (c.roleScores[role] ?? 0) > 0);

  // Group by player using ALT_GROUPS. A player with two characters in the
  // same role (e.g. Trinitree + Totemtartt both healers) collapses into
  // one slot — represents one player, not two characters. Frees up a slot
  // for the next unique player below.
  const altKey = new Map<string, string>(); // name lc -> group key
  ALT_GROUPS.forEach((group, idx) => {
    const key = `g${idx}`;
    for (const name of group) altKey.set(name.toLowerCase(), key);
  });

  const groups = new Map<string, Character[]>();
  for (const c of candidates) {
    const key =
      altKey.get(c.name.toLowerCase()) ?? `solo:${c.name.toLowerCase()}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  // Sort each group's characters by role score desc (top scorer is the
  // slot's primary). Sort the groups by their top scorer's role score.
  const result = [...groups.values()];
  for (const g of result) {
    g.sort(
      (a, b) => (b.roleScores[role] ?? 0) - (a.roleScores[role] ?? 0),
    );
  }
  result.sort(
    (a, b) =>
      (b[0]!.roleScores[role] ?? 0) - (a[0]!.roleScores[role] ?? 0),
  );
  return result.slice(0, n);
}

function bestRole(c: Character): Role {
  // Manual override from ROSTER_PINS wins unconditionally. Used when
  // RIO's score split doesn't match what the player actually plays
  // (e.g. a Prot Paladin who PUGs Ret keys higher than tank keys).
  if (c.roleOverride) return c.roleOverride;
  const { tank, healer, dps } = c.roleScores;
  if (tank >= healer && tank >= dps && tank > 0) return "tank";
  if (healer >= dps && healer > 0) return "healer";
  if (dps > 0) return "dps";
  return c.role;
}
