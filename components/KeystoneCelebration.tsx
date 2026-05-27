"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CLASS_COLOR_VAR, type GuildRun } from "@/lib/types";

// Per-run dismissal so each Resilient achievement is celebrated once per
// browser. Capped to prevent unbounded localStorage growth.
const DISMISSED_KEY = "lib-keystone-dismissed";
const DISMISSED_CAP = 50;

export function KeystoneCelebration({ runs }: { runs: GuildRun[] }) {
  const [show, setShow] = useState(false);
  const [run, setRun] = useState<GuildRun | null>(null);

  useEffect(() => {
    if (!runs.length) return;
    let dismissed: string[] = [];
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      if (raw) dismissed = JSON.parse(raw);
    } catch {}
    const next = runs.find((r) => !dismissed.includes(r.url));
    if (!next) return;
    setRun(next);
    const t = setTimeout(() => setShow(true), 800);
    return () => clearTimeout(t);
  }, [runs]);

  function dismiss() {
    if (!run) return;
    let dismissed: string[] = [];
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      if (raw) dismissed = JSON.parse(raw);
    } catch {}
    dismissed.push(run.url);
    if (dismissed.length > DISMISSED_CAP) {
      dismissed.splice(0, dismissed.length - DISMISSED_CAP);
    }
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
    setShow(false);
  }

  if (!run) return null;
  const primary = run.runners[0];
  if (!primary) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 max-w-sm transition-all duration-500 ${
        show
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-6 opacity-0"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="relative rounded-lg border border-border bg-surface/95 p-4 shadow-xl backdrop-blur-sm">
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-2 top-2 text-lg leading-none text-muted transition-colors hover:text-foreground"
        >
          <span aria-hidden>&times;</span>
        </button>
        <div className="flex gap-3">
          <Image
            src={run.iconUrl}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded"
            unoptimized
          />
          <div className="min-w-0 flex-1 pr-4">
            <p
              className="font-display text-[10px] uppercase tracking-[0.3em]"
              style={{ color: "var(--faction-fg)" }}
            >
              Resilient · +{run.level}
            </p>
            <p className="mt-1 truncate font-display text-base font-semibold">
              <Link
                href={`/character/${primary.realmSlug}/${encodeURIComponent(primary.name)}`}
                className="hover:underline"
                style={{ color: CLASS_COLOR_VAR[primary.class] }}
              >
                {primary.name}
              </Link>
            </p>
            <p className="truncate text-xs text-foreground/80">{run.dungeon}</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-muted">
              {relativeTime(run.completedAt)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function relativeTime(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
