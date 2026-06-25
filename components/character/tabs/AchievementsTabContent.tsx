"use client";

import { useEffect, useState } from "react";
import { formatCstDate } from "@/lib/cst";
import type { AchievementSummary } from "@/lib/types";

/**
 * Achievements tab — lazy. Only mounts when the Achievements tab is the active
 * one (CharacterTabsClient renders just the active tab's element), so this
 * fetch fires only when a visitor actually opens the tab. That keeps the heavy
 * ~2.67MB BNet achievements blob off the default character-page render path;
 * the API route it hits (`/api/achievements`) caches the shaped summary
 * incrementally on the character's achievement points.
 */
export function AchievementsTabContent({
  realmSlug,
  characterName,
}: {
  realmSlug: string;
  characterName: string;
}) {
  const [ach, setAch] = useState<AchievementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`/api/achievements/${realmSlug}/${encodeURIComponent(characterName)}`)
      .then(async (r) => {
        if (r.ok) return (await r.json()) as AchievementSummary;
        if (r.status === 404) return null; // no public achievements data
        throw new Error(`achievements fetch ${r.status}`);
      })
      .then((data) => {
        if (!cancelled) setAch(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [realmSlug, characterName]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-faction border-t-transparent" />
        Loading achievements…
      </div>
    );
  }

  if (error || !ach) {
    return (
      <p className="text-muted">
        Achievements unavailable. (Battle.net API may be rate-limited or this
        character has no public profile.)
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <section>
        <div className="grid gap-3 sm:grid-cols-2">
          <BigStat label="Earned" value={ach.totalQuantity.toLocaleString()} />
          <BigStat
            label="Total Points"
            value={ach.totalPoints.toLocaleString()}
            colorVar="var(--faction-fg)"
          />
        </div>
      </section>

      {ach.recent.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Recently Earned
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-md border border-border bg-surface">
            {ach.recent.map((a) => (
              <li
                key={a.id}
                className="flex items-baseline justify-between gap-3 px-4 py-2.5"
              >
                <a
                  href={`https://www.wowhead.com/achievement=${a.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-wowhead={`achievement=${a.id}&domain=us`}
                  className="font-display text-sm font-semibold hover:underline"
                  style={{ color: "var(--faction-fg)" }}
                >
                  {a.name}
                </a>
                <span className="shrink-0 font-display text-xs text-muted">
                  {formatCstDate(a.timestamp, { withYear: true })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ach.topCategories.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Top Categories by Points
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ach.topCategories.map((c) => (
              <div
                key={c.id}
                className="flex items-baseline justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2"
              >
                <span className="truncate font-display text-sm font-semibold">
                  {c.name}
                </span>
                <span className="shrink-0 font-display text-xs tabular-nums text-muted">
                  {c.quantity}
                  <span className="ml-2" style={{ color: "var(--faction-fg)" }}>
                    {c.points} pts
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
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
