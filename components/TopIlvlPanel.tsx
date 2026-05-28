"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CLASS_COLOR_VAR,
  CLASS_LABEL,
  type Character,
} from "@/lib/types";

type View = "peak" | "keys" | "raids";

const VIEW_ORDER: View[] = ["peak", "keys", "raids"];

const VIEW_META: Record<
  View,
  {
    label: string;
    panelTitle: string;
    callout: () => string;
    empty: string;
  }
> = {
  peak: {
    label: "Peak",
    panelTitle: "Top Peak iLvl",
    callout: () =>
      ", they have big gear on and are the most amazing and bestest.",
    empty:
      "No peak data yet — the next snapshot rebuild will populate this view.",
  },
  keys: {
    label: "In Keys",
    panelTitle: "Top iLvl Equipped in Last Key",
    callout: () =>
      " was wearing this for their last keystone. Receipts, not vibes.",
    empty:
      "No keystones logged yet — view fills in once anyone completes a key.",
  },
  raids: {
    label: "In Raids",
    panelTitle: "Top iLvl Equipped in Last Raid Kill",
    callout: () =>
      " brought this to their last boss kill. Bench the rest.",
    empty:
      "No new boss kills logged since this stat started tracking — view fills in on next raid night.",
  },
};

function readingFor(c: Character, view: View): number | undefined {
  switch (view) {
    case "peak":
      return c.peakIlvl ?? c.ilvl;
    case "keys":
      return c.lastKeyIlvl;
    case "raids":
      return c.lastRaidIlvl;
  }
}

function timestampFor(c: Character, view: View): number | undefined {
  switch (view) {
    case "peak":
      return c.peakIlvlAt;
    case "keys":
      return c.lastKeyAt;
    case "raids":
      return c.lastRaidAt;
  }
}

export function TopIlvlPanel({ roster }: { roster: Character[] }) {
  const [view, setView] = useState<View>("peak");
  const top = useMemo(() => {
    return roster
      .map((c) => ({ c, v: readingFor(c, view) ?? 0 }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v || a.c.name.localeCompare(b.c.name))
      .slice(0, 6)
      .map((x) => x.c);
  }, [roster, view]);
  const leader = top[0];
  const meta = VIEW_META[view];

  const cycleView = () => {
    const i = VIEW_ORDER.indexOf(view);
    setView(VIEW_ORDER[(i + 1) % VIEW_ORDER.length]!);
  };

  return (
    <>
      <div className="mt-4 rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-3">
            <p
              className="font-display text-xs uppercase tracking-widest"
              style={{ color: "var(--faction-fg)" }}
            >
              {meta.panelTitle}
            </p>
            <button
              type="button"
              onClick={cycleView}
              className="rounded border border-border px-2 py-0.5 font-display text-[10px] uppercase tracking-widest text-muted transition-colors hover:border-foreground/40 hover:text-foreground"
              aria-label="Cycle Top iLvl view"
            >
              {meta.label} ↻
            </button>
          </div>
          {leader ? (
            <p className="max-w-prose text-balance text-right text-[10px] italic leading-snug text-muted">
              Watch out for{" "}
              <Link
                href={`/character/${leader.realmSlug}/${encodeURIComponent(leader.name)}`}
                className="font-semibold not-italic hover:underline"
                style={{ color: CLASS_COLOR_VAR[leader.class] }}
              >
                {leader.name}
              </Link>
              {meta.callout()}
            </p>
          ) : null}
        </div>
        {top.length === 0 ? (
          <p className="mt-3 text-xs italic text-muted">{meta.empty}</p>
        ) : (
          <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {top.map((c, i) => (
              <IlvlRow
                key={c.realmSlug + c.name}
                character={c}
                place={i + 1}
                view={view}
              />
            ))}
          </ol>
        )}
      </div>
      <BottomIlvlPanel roster={roster} />
    </>
  );
}

/** Lowest iLvl among characters who attended the most recent guild raid
 *  night — anchored to the max `lastRaidAt` across the roster, then sliced
 *  to anyone within a 24-hour window of that anchor (catches the whole
 *  raid night including people whose BNet refresh straggled by a few
 *  hours). Sorted ascending by `lastRaidIlvl` so loot priority surfaces
 *  the underdressed raiders who actually showed up tonight, not historical
 *  guild kill participants who haven't logged in for weeks. */
const RECENT_RAID_WINDOW_MS = 24 * 60 * 60 * 1000;
function BottomIlvlPanel({ roster }: { roster: Character[] }) {
  const bottom = useMemo(() => {
    const mostRecentRaidAt = roster.reduce(
      (max, c) => Math.max(max, c.lastRaidAt ?? 0),
      0,
    );
    if (mostRecentRaidAt === 0) return [];
    const cutoff = mostRecentRaidAt - RECENT_RAID_WINDOW_MS;
    return roster
      .filter(
        (c) =>
          c.lastRaidAt !== undefined &&
          c.lastRaidAt >= cutoff &&
          c.lastRaidIlvl !== undefined &&
          c.lastRaidIlvl > 0,
      )
      .sort(
        (a, b) =>
          (a.lastRaidIlvl ?? 0) - (b.lastRaidIlvl ?? 0) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 6);
  }, [roster]);
  const lowest = bottom[0];
  return (
    <div className="mt-4 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p
          className="font-display text-xs uppercase tracking-widest"
          style={{ color: "var(--faction-fg)" }}
        >
          Bottom iLvl (Last Raid)
        </p>
        {lowest ? (
          <p className="whitespace-nowrap text-right text-[10px] italic leading-snug text-muted">
            Funnel loot to{" "}
            <Link
              href={`/character/${lowest.realmSlug}/${encodeURIComponent(lowest.name)}`}
              className="font-semibold not-italic hover:underline"
              style={{ color: CLASS_COLOR_VAR[lowest.class] }}
            >
              {lowest.name}
            </Link>
            . Pass anything that drops — the raid carries the weakest link.
          </p>
        ) : null}
      </div>
      {bottom.length === 0 ? (
        <p className="mt-3 text-xs italic text-muted">
          No recent raid data — view populates after the next snapshot picks
          up a fresh raid kill.
        </p>
      ) : (
        <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {bottom.map((c, i) => (
            <IlvlRow
              key={c.realmSlug + c.name}
              character={c}
              place={i + 1}
              view="raids"
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function IlvlRow({
  character: c,
  place,
  view,
}: {
  character: Character;
  place: number;
  view: View;
}) {
  const classColor = CLASS_COLOR_VAR[c.class];
  const reading = readingFor(c, view);
  const reachedAt = timestampFor(c, view);
  return (
    <li>
      <Link
        href={`/character/${c.realmSlug}/${encodeURIComponent(c.name)}`}
        className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-surface"
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
          <p
            className="truncate font-display text-sm font-semibold leading-tight"
            style={{ color: classColor }}
          >
            {c.name}
          </p>
          <p className="truncate text-[10px] uppercase tracking-widest text-muted">
            {c.spec} {CLASS_LABEL[c.class]}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className="whitespace-nowrap font-display text-base font-bold tabular-nums">
            {formatIlvl(reading)}
          </span>
          {reachedAt && (
            <span className="text-[9px] uppercase tracking-widest text-muted">
              {ageLabel(view, reachedAt)}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

/** 3 decimals max, trailing zeros stripped. Matches RosterGrid + Profile. */
function formatIlvl(v: number | undefined): string {
  if (v == null) return "—";
  return String(parseFloat(v.toFixed(3)));
}

/** Verb prefix that matches the active view ("peaked" / "ran" / "killed"
 *  for the three iLvl contexts) followed by a compact relative time. */
function ageLabel(view: View, at: number): string {
  const verb = view === "peak" ? "peaked" : view === "keys" ? "ran" : "killed";
  const now = new Date();
  const then = new Date(at);
  const ms = now.getTime() - then.getTime();
  if (ms < 60 * 60 * 1000) return `${verb} just now`;
  // Calendar-day diff in the viewer's local timezone — see
  // KeystoneCelebration.relativeTime for rationale.
  const nowMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thenMid = new Date(
    then.getFullYear(),
    then.getMonth(),
    then.getDate(),
  );
  const days = Math.round(
    (nowMid.getTime() - thenMid.getTime()) / 86_400_000,
  );
  if (days >= 30) return `${verb} ${Math.floor(days / 30)}mo ago`;
  if (days >= 1) return `${verb} ${days}d ago`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  return `${verb} ${hours}h ago`;
}
