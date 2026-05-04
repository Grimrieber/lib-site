import type { CharacterDetail, PvpBracket } from "@/lib/types";

const BRACKET_LABEL: Record<string, string> = {
  ARENA_2v2: "2v2",
  ARENA_3v3: "3v3",
  BATTLEGROUNDS: "RBG",
  BATTLEGROUNDS_BLITZ: "Blitz",
  SHUFFLE: "Solo Shuffle",
};

export function PvpTabContent({ detail }: { detail: CharacterDetail }) {
  const pvp = detail.pvp;
  if (!pvp) {
    return <p className="text-muted">PVP data unavailable.</p>;
  }

  const noPvp =
    pvp.brackets.length === 0 &&
    pvp.honorableKills === 0 &&
    pvp.honorLevel === 0;
  if (noPvp) {
    return <p className="text-muted">No PVP activity for this character.</p>;
  }

  return (
    <div className="space-y-10">
      <section>
        <div className="grid gap-3 sm:grid-cols-2">
          <BigStat
            label="Honor Level"
            value={pvp.honorLevel.toLocaleString()}
            colorVar="var(--faction-fg)"
          />
          <BigStat
            label="Honorable Kills"
            value={pvp.honorableKills.toLocaleString()}
          />
        </div>
      </section>

      {pvp.brackets.length > 0 ? (
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Rated PVP Brackets
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {pvp.brackets.map((b) => (
              <BracketCard key={b.bracket} bracket={b} />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-muted">No rated PVP this season.</p>
      )}
    </div>
  );
}

function BracketCard({ bracket: b }: { bracket: PvpBracket }) {
  const label = BRACKET_LABEL[b.bracket] ?? b.bracket;
  const stats = b.seasonMatchStatistics;
  const wr =
    stats && stats.played ? ((stats.won ?? 0) / stats.played) * 100 : null;
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p
        className="font-display text-xs uppercase tracking-widest"
        style={{ color: "var(--faction-fg)" }}
      >
        {label}
      </p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums">
        {b.rating > 0 ? b.rating : "—"}
      </p>
      {stats && (stats.played ?? 0) > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-2 text-xs">
          <Stat label="Played" value={stats.played?.toLocaleString() ?? "0"} />
          <Stat label="Won" value={stats.won?.toLocaleString() ?? "0"} />
          <Stat label="Win %" value={wr != null ? `${wr.toFixed(1)}%` : "—"} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-display text-[9px] uppercase tracking-widest text-muted">
        {label}
      </p>
      <p className="mt-0.5 font-display text-sm font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function BigStat({
  label,
  value,
  colorVar,
}: {
  label: string;
  value: string;
  colorVar?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-5">
      <p className="font-display text-xs uppercase tracking-widest text-muted">
        {label}
      </p>
      <p
        className="mt-1 font-display text-4xl font-bold tabular-nums"
        style={colorVar ? { color: colorVar } : undefined}
      >
        {value}
      </p>
    </div>
  );
}
