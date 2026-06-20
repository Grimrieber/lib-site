import Image from "next/image";
import Link from "next/link";
import {
  CLASS_COLOR_VAR,
  type CharacterDetail,
  type KillParticipant,
  type RaidDifficulty,
  type RaidEncounterRow,
  type RaidInstance,
} from "@/lib/types";

const DIFFICULTIES: { key: RaidDifficulty; label: string; color: string }[] = [
  { key: "MYTHIC", label: "M", color: "#ff8000" },
  { key: "HEROIC", label: "H", color: "#a335ee" },
  { key: "NORMAL", label: "N", color: "#0070dd" },
  { key: "LFR", label: "LFR", color: "#9d9d9d" },
];

export function RaidsTabContent({ detail }: { detail: CharacterDetail }) {
  const enc = detail.raidEncounters;
  const noRaids =
    !enc || enc.instances.every((i) => i.encounters.length === 0);

  if (noRaids && !detail.raidProgression) {
    return <p className="text-muted">No raid activity yet.</p>;
  }

  return (
    <div className="space-y-10">
      {detail.raidProgression && (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl font-semibold">
              Current Tier Progress
            </h2>
            {(detail.raidProgression.raidCount ?? 1) > 1 && (
              <p className="text-xs uppercase tracking-widest text-muted">
                Across {detail.raidProgression.raidCount} raids
              </p>
            )}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <RaidStat
              label="Mythic"
              killed={detail.raidProgression.mythicKilled}
              total={
                detail.raidProgression.mythicTotal ??
                detail.raidProgression.totalBosses
              }
              color="#ff8000"
            />
            <RaidStat
              label="Heroic"
              killed={detail.raidProgression.heroicKilled}
              total={
                detail.raidProgression.heroicTotal ??
                detail.raidProgression.totalBosses
              }
              color="#a335ee"
            />
            <RaidStat
              label="Normal"
              killed={detail.raidProgression.normalKilled}
              total={
                detail.raidProgression.normalTotal ??
                detail.raidProgression.totalBosses
              }
              color="#0070dd"
            />
          </div>
        </section>
      )}

      {enc && enc.instances.length > 0 && (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl font-semibold">
              {enc.expansionName} Raids
            </h2>
            <p className="text-xs uppercase tracking-widest text-muted">
              Personal kill history
            </p>
          </div>
          <div className="mt-4 space-y-6">
            {enc.instances
              .filter((i) => i.encounters.length > 0)
              .map((inst) => (
                <InstanceBlock key={inst.instanceId} instance={inst} />
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RaidStat({
  label,
  killed,
  total,
  color,
}: {
  label: string;
  killed: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (killed / total) * 100 : 0;
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p
        className="font-display text-xs uppercase tracking-widest"
        style={{ color }}
      >
        {label}
      </p>
      <p className="mt-1 font-display text-3xl font-bold">
        {killed}
        <span className="text-lg text-muted"> / {total}</span>
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function InstanceBlock({ instance }: { instance: RaidInstance }) {
  const totals: Partial<Record<RaidDifficulty, number>> = {};
  for (const enc of instance.encounters) {
    for (const diff of DIFFICULTIES.map((d) => d.key)) {
      if (enc.perDifficulty[diff]) {
        totals[diff] = (totals[diff] ?? 0) + 1;
      }
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      {instance.tileUrl && (
        <div className="relative h-32 w-full overflow-hidden sm:h-40">
          <Image
            src={instance.tileUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 800px"
            unoptimized
            className="object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface/95 via-surface/40 to-transparent" />
          <h3 className="absolute bottom-3 left-4 font-display text-2xl font-bold drop-shadow-md">
            {instance.instanceName}
          </h3>
        </div>
      )}
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        {!instance.tileUrl && (
          <h3 className="font-display text-lg font-semibold">
            {instance.instanceName}
          </h3>
        )}
        <div className="flex flex-wrap gap-3 text-xs">
          {DIFFICULTIES.map((d) => {
            const cleared = totals[d.key] ?? 0;
            const total = instance.encounters.length;
            return (
              <span key={d.key} className="font-display tabular-nums">
                <span style={{ color: d.color }}>{d.label}</span>
                <span
                  className={cleared > 0 ? "text-foreground" : "text-muted/50"}
                >
                  {" "}
                  {cleared} / {total}
                </span>
              </span>
            );
          })}
        </div>
      </header>
      <ul className="divide-y divide-border">
        {instance.encounters.map((enc) => (
          <EncounterRow key={enc.encounterId} encounter={enc} />
        ))}
      </ul>
    </div>
  );
}

function EncounterRow({ encounter }: { encounter: RaidEncounterRow }) {
  const highest =
    DIFFICULTIES.find((d) => encounter.perDifficulty[d.key])?.key ?? null;
  const lastKill = highest
    ? encounter.perDifficulty[highest]?.lastKillTimestamp
    : null;
  const breakdownDifficulties: {
    raidKey: RaidDifficulty;
    label: string;
    rosterKey?: "Mythic" | "Heroic" | "Normal";
    color: string;
  }[] = [
    { raidKey: "MYTHIC", label: "Mythic", rosterKey: "Mythic", color: "#ff8000" },
    { raidKey: "HEROIC", label: "Heroic", rosterKey: "Heroic", color: "#a335ee" },
    { raidKey: "NORMAL", label: "Normal", rosterKey: "Normal", color: "#0070dd" },
    { raidKey: "LFR", label: "LFR", color: "#9d9d9d" },
  ];
  const breakdown = breakdownDifficulties
    .map((d) => ({
      ...d,
      cleared: encounter.perDifficulty[d.raidKey],
      roster: d.rosterKey ? encounter.killRosters?.[d.rosterKey] : undefined,
    }))
    .filter((d) => !!d.cleared);

  return (
    <li className="flex gap-3 px-3 py-3 sm:px-4">
      {encounter.iconUrl && (
        <Image
          src={encounter.iconUrl}
          alt=""
          width={112}
          height={112}
          unoptimized
          className="h-24 w-24 shrink-0 self-start rounded border border-border object-cover sm:h-28 sm:w-28"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            data-wowhead={`journal-encounter=${encounter.encounterId}&domain=us`}
            className="truncate font-display text-base font-semibold sm:text-lg"
          >
            {encounter.encounterName}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {DIFFICULTIES.map((d) => {
              const data = encounter.perDifficulty[d.key];
              const killed = !!data;
              const tooltip =
                killed && data?.lastKillTimestamp
                  ? `${d.key} ×${data.count} · last killed ${new Date(data.lastKillTimestamp).toLocaleDateString()}`
                  : `${d.key} not yet defeated`;
              return (
                <span
                  key={d.key}
                  title={tooltip}
                  className={`inline-flex items-center gap-1 rounded-md border-2 px-2.5 py-1 font-display text-xs font-bold tabular-nums ${killed ? "" : "border-border/40 text-muted/50"}`}
                  style={
                    killed
                      ? { borderColor: d.color, color: d.color }
                      : undefined
                  }
                >
                  {d.label}
                  {killed && data && (
                    <span className="text-foreground/85">×{data.count}</span>
                  )}
                </span>
              );
            })}
            {lastKill && (
              <span className="ml-1 text-[10px] uppercase tracking-widest text-muted">
                {new Date(lastKill).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </div>
        </div>

        {breakdown.length > 0 && (
          <div className="mt-2 space-y-1">
            {breakdown.map((d) => {
              const hasRoster = (d.roster?.length ?? 0) > 0;
              if (hasRoster) {
                return (
                  <details key={d.raidKey} className="group">
                    <summary className="cursor-pointer list-none font-display text-sm font-semibold uppercase tracking-widest text-muted hover:text-foreground">
                      <span className="group-open:hidden">
                        ▸ <span style={{ color: d.color }}>{d.label}</span> kill
                        roster ({d.roster!.length})
                      </span>
                      <span className="hidden group-open:inline">
                        ▾ <span style={{ color: d.color }}>{d.label}</span> kill
                        roster
                      </span>
                    </summary>
                    <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                      {d
                        .roster!.slice()
                        .sort((a, b) => roleOrder(a.role) - roleOrder(b.role))
                        .map((p) => (
                          <RosterRow
                            key={`${p.realm}-${p.name}`}
                            participant={p}
                          />
                        ))}
                    </ul>
                  </details>
                );
              }
              return (
                <div
                  key={d.raidKey}
                  className="font-display text-sm font-semibold uppercase tracking-widest text-muted"
                >
                  <span style={{ color: d.color }}>{d.label}</span>
                  <span className="text-muted/60"> · pug</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </li>
  );
}

function RosterRow({ participant }: { participant: KillParticipant }) {
  const classColor = CLASS_COLOR_VAR[participant.class];
  return (
    <li className="text-xs">
      <Link
        href={`/character/${participant.realmSlug}/${encodeURIComponent(participant.name)}`}
        className="hover:underline"
        style={{ color: classColor }}
      >
        {participant.name}
      </Link>
      <span className="text-muted"> · {participant.spec}</span>
    </li>
  );
}

function roleOrder(role: KillParticipant["role"]): number {
  if (role === "tank") return 0;
  if (role === "healer") return 1;
  return 2;
}
