"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import type {
  SelectedTalent,
  TalentLoadout,
  TalentSpec,
} from "@/lib/types";

type LazyTalents = {
  classTalents: SelectedTalent[];
  specTalents: SelectedTalent[];
  heroTalents: SelectedTalent[];
  loadoutCode?: string;
};

export function TalentBlock({
  talents,
  realmSlug,
  characterName,
}: {
  talents: TalentLoadout;
  /** Optional — required for lazy off-spec fetching. */
  realmSlug?: string;
  /** Optional — required for lazy off-spec fetching. */
  characterName?: string;
}) {
  // Order: active spec first, then others.
  const ordered = [...talents.specs].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive),
  );

  // All specs start collapsed. The user opens whichever build they want
  // to see. Keeps the initial paint cheap (no talent grids in the DOM)
  // and avoids surprising users with a sometimes-expanded card.
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const toggle = (specId: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(specId)) next.delete(specId);
      else next.add(specId);
      return next;
    });

  return (
    <div className="rounded-md border border-border bg-surface/50 p-4">
      <p
        className="font-display text-[10px] uppercase tracking-widest"
        style={{ color: "var(--faction-fg)" }}
      >
        Specialization
      </p>

      <div className="mt-3 space-y-3">
        {ordered.map((spec) => (
          <SpecDetails
            key={spec.specId}
            spec={spec}
            isExpanded={expanded.has(spec.specId)}
            onToggle={() => toggle(spec.specId)}
            realmSlug={realmSlug}
            characterName={characterName}
          />
        ))}
      </div>
    </div>
  );
}

function SpecDetails({
  spec,
  isExpanded,
  onToggle,
  realmSlug,
  characterName,
}: {
  spec: TalentSpec;
  isExpanded: boolean;
  onToggle: () => void;
  realmSlug?: string;
  characterName?: string;
}) {
  // Off-specs ship without their talent arrays from the server (active spec
  // is the only one resolved upfront, to keep cold-cache page load fast).
  // Fetch them on first expand if we have the addressing info.
  const [lazy, setLazy] = useState<LazyTalents | null>(null);
  const [lazyLoading, setLazyLoading] = useState(false);
  const [lazyError, setLazyError] = useState(false);
  // Set when the API responds 404 — meaning the player has never saved a
  // talent loadout for this spec in-game (BNet only ships builds players
  // have actually visited and saved).
  const [notBuilt, setNotBuilt] = useState(false);

  const arraysMissing =
    spec.classTalents == null &&
    spec.specTalents == null &&
    spec.heroTalents == null;
  const canLazyFetch =
    !!realmSlug && !!characterName && arraysMissing && !spec.isActive;

  useEffect(() => {
    if (!isExpanded || !canLazyFetch || lazy || lazyLoading || notBuilt) return;
    setLazyLoading(true);
    setLazyError(false);
    fetch(
      `/api/talents/${realmSlug}/${encodeURIComponent(characterName!)}/${spec.specId}`,
    )
      .then(async (r) => {
        if (r.ok) return (await r.json()) as LazyTalents;
        // 404 from /api/talents means BNet has no saved loadout for this
        // spec — i.e. the player has never built it. Treat as a known
        // empty state instead of a transient error.
        if (r.status === 404) {
          setNotBuilt(true);
          return null;
        }
        throw new Error(`talents fetch ${r.status}`);
      })
      .then((data) => {
        if (data) setLazy(data);
      })
      .catch(() => setLazyError(true))
      .finally(() => setLazyLoading(false));
  }, [
    isExpanded,
    canLazyFetch,
    lazy,
    lazyLoading,
    notBuilt,
    realmSlug,
    characterName,
    spec.specId,
  ]);

  // Resolve effective talent arrays + loadout code (lazy data wins if present).
  const classTalents = lazy?.classTalents ?? spec.classTalents;
  const specTalents = lazy?.specTalents ?? spec.specTalents;
  const heroTalents = lazy?.heroTalents ?? spec.heroTalents;
  const loadoutCode = lazy?.loadoutCode ?? spec.loadoutCode;

  const knownEmptyBuild =
    !arraysMissing &&
    (classTalents?.length ?? 0) +
      (specTalents?.length ?? 0) +
      (heroTalents?.length ?? 0) ===
      0;

  // No build available AND we know it's empty (active spec server-resolved
  // to nothing) — render as static card. For off-specs we don't know yet,
  // so show as expandable.
  if (knownEmptyBuild) {
    return (
      <div
        className="rounded-md border bg-background"
        style={
          spec.isActive ? { borderColor: "var(--faction)" } : undefined
        }
      >
        <SpecHeader spec={spec} expandable={false} isExpanded={false} />
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-md border bg-background"
      style={spec.isActive ? { borderColor: "var(--faction)" } : undefined}
    >
      <button
        type="button"
        onClick={onToggle}
        className="block w-full cursor-pointer text-left"
      >
        <SpecHeader spec={spec} expandable isExpanded={isExpanded} />
      </button>
      {isExpanded && (
        <div className="border-t border-border p-4">
          {lazyLoading && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-faction border-t-transparent" />
              Loading build…
            </div>
          )}
          {notBuilt && (
            <p className="text-xs text-muted">Not built by user.</p>
          )}
          {lazyError && (
            <p className="text-xs text-muted">
              Couldn&apos;t load this spec&apos;s build. Try again later.
            </p>
          )}
          {!lazyLoading && !lazyError && !notBuilt && (
            <>
              {loadoutCode && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface/50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[10px] uppercase tracking-widest text-muted">
                      Import Code
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted/80">
                      {loadoutCode}
                    </p>
                  </div>
                  <CopyButton value={loadoutCode} label="Copy build" />
                </div>
              )}
              <div className="grid gap-6 lg:grid-cols-3">
                <TalentColumn
                  title="Class Talents"
                  talents={classTalents ?? []}
                />
                <TalentColumn
                  title="Hero Talents"
                  talents={heroTalents ?? []}
                />
                <TalentColumn
                  title="Spec Talents"
                  talents={specTalents ?? []}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SpecHeader({
  spec,
  expandable,
  isExpanded,
}: {
  spec: TalentSpec;
  expandable: boolean;
  isExpanded: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3">
      {spec.iconUrl ? (
        <Image
          src={spec.iconUrl}
          alt=""
          width={40}
          height={40}
          unoptimized
          className="h-10 w-10 shrink-0 rounded border border-border"
        />
      ) : (
        <div className="h-10 w-10 shrink-0 rounded border border-border bg-surface" />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={`font-display text-[9px] uppercase tracking-widest ${spec.isActive ? "" : "text-muted"}`}
          style={spec.isActive ? { color: "var(--faction-fg)" } : undefined}
        >
          {spec.isActive ? "Active Spec" : "Off-Spec"}
        </p>
        <p className="truncate font-display text-sm font-semibold">
          {spec.specName}
        </p>
        {spec.heroTalentName && (
          <p className="truncate text-[11px] text-muted">
            {spec.heroTalentName}
          </p>
        )}
      </div>
      {expandable && (
        <span className="font-display text-xs uppercase tracking-widest text-muted">
          {isExpanded ? "▾ Hide" : "▸ Build"}
        </span>
      )}
    </div>
  );
}

function TalentColumn({
  title,
  talents,
}: {
  title: string;
  talents: SelectedTalent[];
}) {
  if (talents.length === 0) {
    return (
      <div>
        <p className="font-display text-xs uppercase tracking-widest text-muted">
          {title}
        </p>
        <p className="mt-2 text-xs text-muted/60">No talents selected.</p>
      </div>
    );
  }

  // Group by row, sort each row by col.
  const byRow = new Map<number, SelectedTalent[]>();
  for (const t of talents) {
    const arr = byRow.get(t.row) ?? [];
    arr.push(t);
    byRow.set(t.row, arr);
  }
  const rows = [...byRow.entries()].sort(([a], [b]) => a - b);
  for (const [, group] of rows) group.sort((a, b) => a.col - b.col);

  return (
    <div>
      <p className="font-display text-xs uppercase tracking-widest text-muted">
        {title}
      </p>
      <div className="mt-3 space-y-1.5">
        {rows.map(([row, group]) => (
          <div
            key={row}
            className="flex flex-wrap items-center justify-center gap-1.5"
          >
            {group.map((t) => (
              <TalentIcon key={t.nodeId} talent={t} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TalentIcon({ talent }: { talent: SelectedTalent }) {
  const showRank = talent.maxRanks > 1;
  return (
    <a
      href={`https://www.wowhead.com/spell=${talent.spellId}`}
      target="_blank"
      rel="noopener noreferrer"
      data-wowhead={`spell=${talent.spellId}&domain=us`}
      className="relative block h-10 w-10 overflow-hidden rounded border-2 border-faction/70 transition-transform hover:scale-110"
      title={talent.name}
    >
      {talent.iconUrl && (
        <Image
          src={talent.iconUrl}
          alt={talent.name}
          fill
          sizes="40px"
          unoptimized
          className="object-cover"
        />
      )}
      {showRank && (
        <span className="absolute bottom-0 right-0 rounded-tl bg-background/90 px-1 font-display text-[10px] font-bold leading-tight text-foreground">
          {talent.rank}/{talent.maxRanks}
        </span>
      )}
    </a>
  );
}
