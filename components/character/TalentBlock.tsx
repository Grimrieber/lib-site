"use client";

import Image from "next/image";
import { useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import type {
  SelectedTalent,
  TalentLoadout,
  TalentSpec,
} from "@/lib/types";

export function TalentBlock({ talents }: { talents: TalentLoadout }) {
  // Order: active spec first, then others.
  const ordered = [...talents.specs].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive),
  );

  // Track which specs are expanded. Active spec starts open; others start
  // closed. Closed specs render only the header — their inner grid (and
  // 100+ talent icons per spec) doesn't hit the DOM until the user clicks.
  // This was a real perf footgun — paladin/druid characters were fetching
  // 450+ icons on initial page load.
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(ordered.filter((s) => s.isActive).map((s) => s.specId)),
  );
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
}: {
  spec: TalentSpec;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const hasBuild =
    (spec.classTalents?.length ?? 0) +
      (spec.specTalents?.length ?? 0) +
      (spec.heroTalents?.length ?? 0) >
    0;

  // No build available — render as static card (no expand affordance).
  if (!hasBuild) {
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
          {spec.loadoutCode && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface/50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-display text-[10px] uppercase tracking-widest text-muted">
                  Import Code
                </p>
                <p className="truncate font-mono text-[11px] text-muted/80">
                  {spec.loadoutCode}
                </p>
              </div>
              <CopyButton value={spec.loadoutCode} label="Copy build" />
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-3">
            <TalentColumn
              title="Class Talents"
              talents={spec.classTalents ?? []}
            />
            <TalentColumn
              title="Hero Talents"
              talents={spec.heroTalents ?? []}
            />
            <TalentColumn
              title="Spec Talents"
              talents={spec.specTalents ?? []}
            />
          </div>
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
