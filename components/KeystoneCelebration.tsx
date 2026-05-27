"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CLASS_COLOR_VAR, type ResilientAchievement } from "@/lib/types";

const CONFETTI_COUNT = 32;
const CONFETTI_COLORS = [
  "var(--faction-fg)",
  "var(--faction)",
  "#fff4c2", // soft gold
  "#f8c560", // amber
  "#ffffff",
];

type ConfettiPiece = {
  left: string;
  bg: string;
  width: number;
  height: number;
  drift: string;
  rot: string;
  dur: string;
  delay: string;
};

function buildConfetti(): ConfettiPiece[] {
  return Array.from({ length: CONFETTI_COUNT }).map(() => {
    return {
      left: `${Math.random() * 100}%`,
      bg: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      width: 6 + Math.random() * 6,
      height: 8 + Math.random() * 10,
      drift: `${(Math.random() - 0.5) * 240}px`,
      rot: `${360 + Math.random() * 720}deg`,
      dur: `${2.4 + Math.random() * 1.8}s`,
      delay: `${Math.random() * 0.5}s`,
    } satisfies ConfettiPiece;
  });
}

// Gap-based "fresh visit" check. We can't trust sessionStorage to clear
// across browser closes (Chrome's "Continue where you left off" preserves
// it), so we use a localStorage timestamp instead: if the user hasn't hit
// the home page within SESSION_THRESHOLD_MS, treat the next visit as fresh
// and fire the popup again.
const LAST_SHOWN_KEY = "lib-keystone-last-shown-ms";
const SESSION_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

// Per-cohort: each unique set of current winners is celebrated once across
// sessions too. When a new Resilient lands, the cohort key changes and the
// modal will fire again on the next fresh visit.
const COHORT_DISMISSED_KEY = "lib-keystone-dismissed-cohort";
const DISMISSED_CAP = 20;

export function KeystoneCelebration({
  recent,
  top,
}: {
  recent: ResilientAchievement[];
  top: ResilientAchievement[];
}) {
  const [mounted, setMounted] = useState(false);
  const [show, setShow] = useState(false);
  const confetti = useMemo<ConfettiPiece[]>(
    () => (show ? buildConfetti() : []),
    [show],
  );

  // Cohort key keyed on this week's earners — when a new champion joins,
  // the cohort changes and the popup is eligible to fire again.
  const cohortKey = recent
    .map((a) => `${a.runner.name}@${a.level}@${a.earnedAt}`)
    .sort()
    .join("|");

  useEffect(() => {
    const force =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("celebrate") === "1";

    // No fresh earners this week → silence. The popup is meant to celebrate
    // new achievements, not display a permanent leaderboard.
    if (!recent.length) {
      console.log(
        "[KeystoneCelebration] no Resilient achievements within 7 days — popup suppressed",
      );
      return;
    }

    if (!force) {
      let dismissed: string[] = [];
      try {
        const raw = localStorage.getItem(COHORT_DISMISSED_KEY);
        if (raw) dismissed = JSON.parse(raw);
      } catch {}
      if (dismissed.includes(cohortKey)) {
        console.log(
          "[KeystoneCelebration] cohort already dismissed — popup suppressed",
        );
        return;
      }

      const now = Date.now();
      const lastShownStr = localStorage.getItem(LAST_SHOWN_KEY);
      if (lastShownStr) {
        const lastShown = parseInt(lastShownStr, 10);
        if (
          Number.isFinite(lastShown) &&
          now - lastShown < SESSION_THRESHOLD_MS
        ) {
          console.log(
            `[KeystoneCelebration] recent visit (${Math.round(
              (now - lastShown) / 1000,
            )}s ago) — popup suppressed`,
          );
          localStorage.setItem(LAST_SHOWN_KEY, String(now));
          return;
        }
      }

      localStorage.setItem(LAST_SHOWN_KEY, String(now));
    } else {
      console.log("[KeystoneCelebration] forced via ?celebrate=1");
    }

    setMounted(true);
    const t = setTimeout(() => setShow(true), 500);
    return () => clearTimeout(t);
  }, [cohortKey, recent.length]);

  function dismiss() {
    let dismissed: string[] = [];
    try {
      const raw = localStorage.getItem(COHORT_DISMISSED_KEY);
      if (raw) dismissed = JSON.parse(raw);
    } catch {}
    if (!dismissed.includes(cohortKey)) dismissed.push(cohortKey);
    if (dismissed.length > DISMISSED_CAP) {
      dismissed.splice(0, dismissed.length - DISMISSED_CAP);
    }
    localStorage.setItem(COHORT_DISMISSED_KEY, JSON.stringify(dismissed));
    setShow(false);
    setTimeout(() => setMounted(false), 400);
  }

  if (!recent.length || !mounted) return null;
  const [featured, ...rest] = recent;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 transition-opacity duration-300 ${
        show ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="keystone-celebration-title"
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="absolute inset-0 cursor-pointer bg-black/70 backdrop-blur-md"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, color-mix(in srgb, var(--faction-fg) 14%, transparent), transparent 65%)",
        }}
      />

      {show && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          {confetti.map((c, i) => (
            <span
              key={i}
              className="lib-confetti absolute block rounded-[2px]"
              style={
                {
                  left: c.left,
                  top: "-12%",
                  width: `${c.width}px`,
                  height: `${c.height}px`,
                  background: c.bg,
                  ["--x" as string]: "0px",
                  ["--drift" as string]: c.drift,
                  ["--rot" as string]: c.rot,
                  ["--dur" as string]: c.dur,
                  ["--delay" as string]: c.delay,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}

      <div
        className={`relative w-full max-w-sm max-h-[92vh] overflow-y-auto ${show ? "lib-celebration-bounce" : ""}`}
      >
        <div
          className="relative overflow-hidden rounded-2xl border bg-surface shadow-2xl"
          style={{
            borderColor:
              "color-mix(in srgb, var(--faction-fg) 55%, transparent)",
            boxShadow:
              "0 30px 80px -20px color-mix(in srgb, var(--faction-fg) 60%, transparent), 0 0 80px -10px color-mix(in srgb, var(--faction-fg) 40%, transparent)",
          }}
        >
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 text-3xl leading-none text-muted transition-colors hover:text-foreground"
          >
            <span aria-hidden>&times;</span>
          </button>

          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-48"
            style={{
              backgroundImage:
                "radial-gradient(ellipse at top, color-mix(in srgb, var(--faction-fg) 32%, transparent) 0%, transparent 65%)",
            }}
          />

          <div className="relative px-4 pb-1 pt-4 text-center">
            <Sparkle className="absolute left-[8%] top-4 h-3 w-3" delay="0s" />
            <Sparkle
              className="absolute right-[10%] top-3 h-3 w-3"
              delay="0.4s"
            />
            <Sparkle
              className="absolute left-[18%] top-12 h-2 w-2"
              delay="0.9s"
            />
            <Sparkle
              className="absolute right-[18%] top-10 h-2 w-2"
              delay="0.6s"
            />

            <p
              id="keystone-celebration-title"
              className="lib-celebration-title lib-celebration-rise font-display text-sm font-bold tracking-[0.15em] sm:text-base"
              style={{ color: "var(--faction-fg)", animationDelay: "0ms" }}
            >
              RESILIENT WEEKLY CHAMPIONS
            </p>
          </div>

          <div className="relative px-4 pb-3 pt-3">
            <div className="relative mx-auto flex flex-col items-center text-center">
              <div
                aria-hidden
                className="lib-celebration-rays pointer-events-none absolute left-1/2 top-1/2 h-[120px] w-[120px] -translate-x-1/2 -translate-y-1/2 opacity-55 sm:h-[150px] sm:w-[150px]"
              />

              <p
                className="lib-celebration-pop relative font-display text-[2.75rem] font-bold leading-none sm:text-[3.5rem]"
                style={{
                  color: "var(--faction-fg)",
                  textShadow:
                    "0 0 16px color-mix(in srgb, var(--faction-fg) 70%, transparent), 0 0 32px color-mix(in srgb, var(--faction-fg) 40%, transparent)",
                  animationDelay: "260ms",
                }}
              >
                +{featured.level}
              </p>
              <p
                className="lib-celebration-rise relative mt-1 font-display text-sm font-bold leading-tight sm:text-base"
                style={{ animationDelay: "560ms" }}
              >
                <Link
                  href={`/character/${featured.runner.realmSlug}/${encodeURIComponent(featured.runner.name)}`}
                  className="hover:underline"
                  style={{ color: CLASS_COLOR_VAR[featured.runner.class] }}
                  onClick={dismiss}
                >
                  {featured.runner.name}
                </Link>
              </p>
              <p
                className="lib-celebration-rise relative mt-0.5 text-[10px] uppercase tracking-[0.3em] text-muted"
                style={{ animationDelay: "700ms" }}
              >
                {relativeTime(featured.earnedAt)}
              </p>
            </div>
          </div>

          {rest.length > 0 && (
            <div className="border-t border-border px-4 pb-2.5 pt-2.5">
              <p className="mb-1.5 text-center font-display text-[9px] uppercase tracking-[0.4em] text-muted">
                Also this week
              </p>
              <ul className="space-y-1">
                {rest.map((a, i) => (
                  <li
                    key={`${a.runner.name}@${a.level}@${a.earnedAt}`}
                    className="lib-celebration-rise flex items-center gap-2.5 rounded-md bg-background/40 px-2.5 py-1"
                    style={{
                      animationDelay: `${820 + i * 80}ms`,
                    }}
                  >
                    <p
                      className="shrink-0 font-display text-base font-bold"
                      style={{ color: "var(--faction-fg)" }}
                    >
                      +{a.level}
                    </p>
                    <p className="min-w-0 flex-1 truncate font-display text-xs font-semibold">
                      <Link
                        href={`/character/${a.runner.realmSlug}/${encodeURIComponent(a.runner.name)}`}
                        className="hover:underline"
                        style={{ color: CLASS_COLOR_VAR[a.runner.class] }}
                        onClick={dismiss}
                      >
                        {a.runner.name}
                      </Link>
                    </p>
                    <p className="shrink-0 text-[9px] uppercase tracking-widest text-muted">
                      {relativeTime(a.earnedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {top.length > 0 && (
            <div className="border-t border-border px-4 pb-3 pt-2.5">
              <p className="mb-1.5 text-center font-display text-[9px] uppercase tracking-[0.4em] text-muted">
                Top {top.length} Resilient
              </p>
              <ol className="space-y-1">
                {top.map((a, i) => (
                  <li
                    key={`top-${a.runner.name}@${a.level}`}
                    className="lib-celebration-rise flex items-center gap-2.5 rounded-md bg-background/40 px-2.5 py-1"
                    style={{
                      animationDelay: `${980 + i * 90}ms`,
                    }}
                  >
                    <p
                      className="shrink-0 font-display text-[10px] font-bold tracking-widest text-muted"
                      aria-hidden
                    >
                      {i + 1}
                    </p>
                    <p
                      className="shrink-0 font-display text-base font-bold"
                      style={{ color: "var(--faction-fg)" }}
                    >
                      +{a.level}
                    </p>
                    <p className="min-w-0 flex-1 truncate font-display text-xs font-semibold">
                      <Link
                        href={`/character/${a.runner.realmSlug}/${encodeURIComponent(a.runner.name)}`}
                        className="hover:underline"
                        style={{ color: CLASS_COLOR_VAR[a.runner.class] }}
                        onClick={dismiss}
                      >
                        {a.runner.name}
                      </Link>
                    </p>
                    <p className="shrink-0 font-display text-[11px] font-semibold text-foreground/85">
                      {Math.round(a.score)}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Sparkle({
  className = "",
  delay = "0s",
}: {
  className?: string;
  delay?: string;
}) {
  return (
    <svg
      className={`lib-celebration-sparkle ${className}`}
      style={{ animationDelay: delay, color: "var(--faction-fg)" }}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 0 L13.5 9 L24 12 L13.5 15 L12 24 L10.5 15 L0 12 L10.5 9 Z" />
    </svg>
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
