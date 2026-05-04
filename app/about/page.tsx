import Image from "next/image";
import Link from "next/link";
import { NavReady } from "@/components/NavReady";
import { ABOUT, FACTION_DESCRIPTION, LEADERSHIP } from "@/lib/content";
import { GUILD } from "@/lib/config";
import { getGuildSnapshot } from "@/lib/raiderio";
import { CLASS_COLOR_VAR, CLASS_LABEL, type Character } from "@/lib/types";

export const metadata = {
  title: "About — Lessons in Brutality",
};

export default async function AboutPage() {
  const snapshot = await getGuildSnapshot();
  // Resolve each leadership entry to a roster character (case-insensitive
  // name match). Configured in lib/content.ts; falls back gracefully if a
  // name isn't on the active roster (e.g. a leader's main is parked).
  const leaders = LEADERSHIP.map((l) => {
    const character = snapshot.roster.find(
      (c) => c.name.toLowerCase() === l.mainName.toLowerCase(),
    );
    return character ? { character, title: l.title, blurb: l.blurb } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <NavReady />
      <p
        className="font-display text-xs uppercase tracking-[0.4em]"
        style={{ color: "var(--faction-fg)" }}
      >
        Who We Are
      </p>
      <h1 className="mt-2 font-display text-5xl font-bold">About</h1>
      <div className="mt-6 space-y-4 text-base leading-relaxed text-foreground/90">
        {ABOUT.intro.map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold">Raid Schedule</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {ABOUT.schedule.map((s) => (
            <div
              key={s.day}
              className="rounded-md border border-border bg-surface p-4"
              style={{ borderLeft: "3px solid var(--faction)" }}
            >
              <p
                className="font-display text-xs uppercase tracking-widest"
                style={{ color: "var(--faction-fg)" }}
              >
                {s.day}
              </p>
              <p className="mt-1 font-display text-base font-semibold">
                {s.time}
              </p>
              <p className="mt-0.5 text-xs text-muted">{s.note}</p>
            </div>
          ))}
        </div>
        {ABOUT.scheduleNote && (
          <p className="mt-3 text-xs text-muted">{ABOUT.scheduleNote}</p>
        )}
      </section>

      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold">Leadership</h2>
        <p className="mt-1 text-sm text-muted">
          The guild is co-led by these three.
        </p>
        {leaders.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {leaders.map((l) => (
              <LeaderCard
                key={l.character.realmSlug + l.character.name}
                character={l.character}
                title={l.title}
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">
            Leadership roster pending — configure in{" "}
            <code className="font-mono text-xs">lib/content.ts</code>.
          </p>
        )}
      </section>

      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold">Loot Rules</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {ABOUT.lootRules.map((rule) => (
            <div
              key={rule.title}
              className="rounded-md border border-border bg-surface p-4"
            >
              <h3
                className="font-display text-sm font-semibold uppercase tracking-widest"
                style={{ color: "var(--faction-fg)" }}
              >
                {rule.title}
              </h3>
              <p className="mt-2 text-sm text-foreground/85">{rule.body}</p>
            </div>
          ))}
        </div>
        {ABOUT.lootRulesNote && (
          <p className="mt-3 text-xs text-muted">{ABOUT.lootRulesNote}</p>
        )}
      </section>

      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold">The Guild</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <Stat label="Realm" value={`${GUILD.realmDisplay}-${GUILD.regionDisplay}`} />
          <Stat label="Faction" value={FACTION_DESCRIPTION} />
          <Stat label="Active Raiders" value={`${snapshot.roster.length}`} />
        </dl>
      </section>
    </div>
  );
}

function LeaderCard({
  character,
  title,
}: {
  character: Character;
  title: string;
}) {
  const classColor = CLASS_COLOR_VAR[character.class];
  return (
    <Link
      href={`/character/${character.realmSlug}/${encodeURIComponent(character.name)}`}
      className="group flex items-center gap-4 rounded-md border border-border bg-surface p-4 transition-colors hover:border-foreground/30"
    >
      {character.avatarUrl ? (
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
      ) : (
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded font-display text-xl font-bold"
          style={{ border: `2px solid ${classColor}`, color: classColor }}
        >
          {character.name[0]?.toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <p
          className="font-display text-[10px] uppercase tracking-widest"
          style={{ color: "var(--faction-fg)" }}
        >
          {title}
        </p>
        <p
          className="truncate font-display text-xl font-semibold"
          style={{ color: classColor }}
        >
          {character.name}
        </p>
        <p className="truncate text-xs text-muted">
          {character.spec} {CLASS_LABEL[character.class]}
        </p>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <dt className="font-display text-[10px] uppercase tracking-widest text-muted">
        {label}
      </dt>
      <dd className="mt-1 font-display text-xl font-semibold">{value}</dd>
    </div>
  );
}
