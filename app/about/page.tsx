import Image from "next/image";
import Link from "next/link";
import { NavReady } from "@/components/NavReady";
import { ABOUT, FACTION_DESCRIPTION, IN_MEMORIAM, LEADERSHIP } from "@/lib/content";
import { GUILD } from "@/lib/config";
import { getGuildSnapshot } from "@/lib/raiderio";
import { CLASS_COLOR_VAR, CLASS_LABEL, type Character, type WowClass } from "@/lib/types";

export const metadata = {
  title: "About — Lessons in Brutality",
};

export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const snapshot = await getGuildSnapshot();
  // Always show all 3 leaders, even if a leader's main isn't currently in
  // snapshot.roster (e.g. activity filter dropped them, parked toon, or
  // RIO returned a partial member list). Resolve from the roster for
  // class color / avatar when possible; otherwise render a minimal card.
  const leaders = LEADERSHIP.map((l) => {
    const character = snapshot.roster.find(
      (c) => c.name.toLowerCase() === l.mainName.toLowerCase(),
    );
    return { mainName: l.mainName, title: l.title, blurb: l.blurb, character };
  });

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
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {leaders.map((l) =>
            l.character ? (
              <LeaderCard
                key={l.character.realmSlug + l.character.name}
                character={l.character}
                title={l.title}
              />
            ) : (
              <LeaderCardFallback
                key={l.mainName}
                name={l.mainName}
                title={l.title}
              />
            ),
          )}
        </div>
      </section>

      {snapshot.roster.some((c) => c.isOfficer) && (
        <section className="mt-14">
          <h2 className="font-display text-2xl font-semibold">Officers</h2>
          <p className="mt-1 text-sm text-muted">
            Officers help run raid and recruitment — whisper any of them
            in-game.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {snapshot.roster
              .filter((c) => c.isOfficer)
              .sort((a, b) =>
                a.rankNumber - b.rankNumber ||
                a.name.localeCompare(b.name),
              )
              .map((c) => (
                <LeaderCard
                  key={c.realmSlug + c.name}
                  character={c}
                  title="Officer"
                />
              ))}
          </div>
        </section>
      )}

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

      {IN_MEMORIAM.length > 0 && (
        <section className="mt-14">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-display text-2xl font-semibold">In Memoriam</h2>
            <p
              className="font-display text-xs uppercase tracking-[0.3em]"
              style={{ color: "var(--faction-fg)" }}
            >
              Gone but never forgotten
            </p>
          </div>
          <p className="mt-1 text-sm text-muted">
            Guildmates we&apos;ve lost. Remembered here by the people who logged
            on with them.
          </p>
          <div className="mt-4 space-y-4">
            {IN_MEMORIAM.map((m) => (
              <article
                key={m.name}
                className="rounded-md border border-border bg-surface p-6 sm:p-8"
                style={{ borderTop: "2px solid var(--faction)" }}
              >
                <div>
                  {m.imageSrc && (
                    <div className="relative mb-5 h-32 w-32 overflow-hidden rounded sm:float-right sm:mb-3 sm:ml-6 sm:h-36 sm:w-36">
                      <Image
                        src={m.imageSrc}
                        alt={m.name}
                        fill
                        sizes="(min-width: 640px) 144px, 128px"
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p
                      className="font-display text-[10px] uppercase tracking-[0.3em]"
                      style={{ color: "var(--faction-fg)" }}
                    >
                      In Memory
                    </p>
                    <h3 className="mt-1 font-display text-2xl font-semibold">
                      {m.name}
                    </h3>
                    <div className="mt-0.5 space-y-0.5 text-xs uppercase tracking-widest text-muted">
                      {m.bornOn && <p>Born {m.bornOn}</p>}
                      <p>Passed {m.passedOn}</p>
                    </div>
                    {m.mainCharacter && (
                      <>
                        <p className="mt-2 text-xs text-muted">
                          Known in-game as{" "}
                          <MainCharacterName
                            name={m.mainCharacter.name}
                            realmSlug={m.mainCharacter.realmSlug}
                            className={m.mainCharacter.className}
                          />
                        </p>
                        {m.mainCharacter.rank && (
                          <p className="mt-0.5 text-xs text-muted">
                            Rank{" "}
                            <span style={{ color: "var(--faction-fg)" }}>
                              {m.mainCharacter.rank}
                            </span>
                          </p>
                        )}
                      </>
                    )}
                    <div className="mt-4 space-y-3 text-sm leading-relaxed text-foreground/85">
                      {m.tribute.map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>
                    <details className="group clear-both mt-6 border-t border-border pt-5">
                      <summary
                        className="cursor-pointer list-none font-display text-[10px] uppercase tracking-[0.3em] text-muted transition-colors hover:text-foreground"
                      >
                        Share a memory of {m.name.split(" ")[0]}
                        <span className="ml-2 inline-block transition-transform group-open:rotate-180">
                          ⌄
                        </span>
                      </summary>
                      <p className="mt-3 text-sm leading-relaxed text-foreground/85">
                        Have a memory you&apos;d like added? DM{" "}
                        <span
                          className="font-display uppercase tracking-widest"
                          style={{ color: "var(--faction-fg)" }}
                        >
                          Grim
                        </span>{" "}
                        on Discord with what you&apos;d like included, and it&apos;ll
                        be added here.
                      </p>
                    </details>
                    {m.memories && m.memories.length > 0 && (
                      <details
                        open
                        className="group mt-5 border-t border-border pt-4"
                      >
                        <summary className="cursor-pointer list-none font-display text-[10px] uppercase tracking-[0.3em] text-muted transition-colors hover:text-foreground">
                          Memories
                          <span className="ml-2 inline-block transition-transform group-open:rotate-180">
                            ⌄
                          </span>
                        </summary>
                        <div className="mt-3 space-y-3">
                          {m.memories.map((mem, i) => (
                            <div
                              key={i}
                              className="rounded-md border border-border bg-surface/60 p-4"
                            >
                              <p
                                className="font-display text-[10px] uppercase tracking-[0.3em]"
                                style={{ color: "var(--faction-fg)" }}
                              >
                                {mem.from}
                              </p>
                              <div className="mt-2 space-y-3 text-sm leading-relaxed text-foreground/85">
                                {(Array.isArray(mem.text) ? mem.text : [mem.text]).map((para, j) => (
                                  <p key={j}>{para}</p>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
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

/** Renders a leader who isn't currently in the active roster (e.g. parked
 *  alt, dropped by activity filter, or a partial RIO snapshot). Same shape
 *  as LeaderCard so the grid stays uniform. Links to the character page —
 *  it'll either load if BNet has the data or 404 cleanly if not. */
function LeaderCardFallback({
  name,
  title,
}: {
  name: string;
  title: string;
}) {
  return (
    <Link
      href={`/character/${GUILD.realm}/${encodeURIComponent(name)}`}
      className="group flex items-center gap-4 rounded-md border border-border bg-surface p-4 transition-colors hover:border-foreground/30"
    >
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded font-display text-xl font-bold"
        style={{
          border: `2px solid var(--faction)`,
          color: "var(--faction-fg)",
        }}
      >
        {name[0]?.toUpperCase()}
      </div>
      <div className="min-w-0">
        <p
          className="font-display text-[10px] uppercase tracking-widest"
          style={{ color: "var(--faction-fg)" }}
        >
          {title}
        </p>
        <p
          className="truncate font-display text-xl font-semibold"
          style={{ color: "var(--faction-fg)" }}
        >
          {name}
        </p>
      </div>
    </Link>
  );
}

function MainCharacterName({
  name,
  realmSlug,
  className,
}: {
  name: string;
  realmSlug?: string;
  className?: WowClass;
}) {
  const color = className ? CLASS_COLOR_VAR[className] : "var(--faction-fg)";
  const style = { color };
  if (realmSlug) {
    return (
      <Link
        href={`/character/${realmSlug}/${encodeURIComponent(name)}`}
        className="font-display uppercase tracking-widest underline-offset-4 hover:underline"
        style={style}
      >
        {name}
      </Link>
    );
  }
  return (
    <span
      className="font-display uppercase tracking-widest"
      style={style}
    >
      {name}
    </span>
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
