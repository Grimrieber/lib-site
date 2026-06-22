"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Error boundary for the character route. The first visit to a never-generated
 * character renders on-demand via the live BNet/RIO fanout; if that cold gen
 * times out or hits a transient upstream blip it throws here. The failed
 * attempt warms Next's data cache, so an immediate retry (what a manual refresh
 * was already doing) almost always succeeds. Auto-retry a couple of times before
 * showing a manual fallback so we never loop forever on a genuinely-broken page.
 */
export default function CharacterError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [tries, setTries] = useState(0);
  const autoRetrying = tries < 2;

  useEffect(() => {
    if (!autoRetrying) return;
    const t = setTimeout(() => {
      setTries((n) => n + 1);
      reset();
    }, 600);
    return () => clearTimeout(t);
    // `error` in deps so a fresh failure after a reset re-arms the retry.
  }, [autoRetrying, reset, error]);

  if (autoRetrying) {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-3xl flex-col items-center justify-center px-4 py-16 text-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-border"
          style={{ borderTopColor: "var(--faction-fg)" }}
          aria-hidden
        />
        <p className="mt-5 font-display text-xs uppercase tracking-[0.3em] text-muted">
          Loading character…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[40vh] max-w-3xl flex-col items-center justify-center px-4 py-16 text-center">
      <p
        className="font-display text-xs uppercase tracking-[0.4em]"
        style={{ color: "var(--faction-fg)" }}
      >
        Couldn’t load this character
      </p>
      <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
        The armory didn’t answer.
      </h1>
      <p className="mt-5 max-w-md text-sm leading-relaxed text-muted">
        Raider.IO or Blizzard was slow to respond. This usually clears on a
        retry.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => {
            setTries(0);
            reset();
          }}
          className="rounded-md border-2 px-5 py-2.5 font-display text-xs uppercase tracking-widest transition-colors hover:bg-foreground/5"
          style={{ borderColor: "var(--faction)", color: "var(--faction-fg)" }}
        >
          Try again
        </button>
        <Link
          href="/roster"
          className="rounded-md border border-border px-5 py-2.5 font-display text-xs uppercase tracking-widest text-muted transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          Back to roster
        </Link>
      </div>
    </div>
  );
}
