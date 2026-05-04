"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/**
 * Global navigation loading modal. Hides on the `lib:nav-ready` event
 * dispatched by route layouts when their resolved content (not skeleton)
 * actually commits to the DOM. Also has a hard safety cap so a stuck
 * navigation doesn't trap the user staring at a spinner forever.
 *
 * Why not pathname-change: in App Router, `usePathname()` updates eagerly
 * during Link transitions — well before the new route's UI is visible.
 * Hiding on pathname-change uncovers the OLD route while it's still on
 * screen, which reads as "modal disappeared but page didn't change."
 */
const MIN_SHOW_MS = 400;
const MAX_SHOW_MS = 30_000;

export function NavLoadingOverlay() {
  const [pending, setPending] = useState(false);
  const startedAtRef = useRef(0);

  // Primary hide signal: the new route's content dispatches `lib:nav-ready`
  // once it has actually mounted (i.e., after Suspense'd async data has
  // resolved). That's the moment the user can be shown the new page.
  useEffect(() => {
    if (!pending) return;
    function onReady() {
      const elapsed = Date.now() - startedAtRef.current;
      const wait = Math.max(0, MIN_SHOW_MS - elapsed);
      setTimeout(() => setPending(false), wait);
    }
    window.addEventListener("lib:nav-ready", onReady);
    return () => window.removeEventListener("lib:nav-ready", onReady);
  }, [pending]);

  // Safety cap. If `lib:nav-ready` never fires (navigation failed, route
  // doesn't dispatch the event, etc.), drop the modal after MAX_SHOW_MS.
  useEffect(() => {
    if (!pending) return;
    const elapsed = Date.now() - startedAtRef.current;
    const t = setTimeout(
      () => setPending(false),
      Math.max(0, MAX_SHOW_MS - elapsed),
    );
    return () => clearTimeout(t);
  }, [pending]);

  useEffect(() => {
    function start() {
      startedAtRef.current = Date.now();
      setPending(true);
    }

    function onClick(e: MouseEvent) {
      // Plain left-click only; let cmd/ctrl-click open new tab without
      // showing a stuck overlay on the current page.
      if (
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const link = (e.target as HTMLElement | null)?.closest?.("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href) return;
      if (link.target === "_blank") return;
      if (href.startsWith("#")) return;
      // External (mailto:, http:, etc.) — anything with a scheme that
      // isn't a relative path.
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("/")) return;
      if (link.hasAttribute("download")) return;
      // Same-page link — no actual navigation.
      try {
        const targetUrl = new URL(href, window.location.href);
        if (
          targetUrl.pathname === window.location.pathname &&
          targetUrl.search === window.location.search
        ) {
          return;
        }
      } catch {
        // Malformed href; bail without showing modal.
        return;
      }
      start();
    }

    function onSubmit(e: SubmitEvent) {
      const form = e.target as HTMLFormElement | null;
      if (!form) return;
      // Forms without an action attribute are JS-driven (e.g. the recruit
      // form posting via fetch). Skip those — no navigation will happen.
      const action = form.getAttribute("action");
      if (!action) return;
      start();
    }

    // Capture phase so we see clicks before React's event delegation
    // (which is where Next.js Link calls preventDefault).
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  if (!pending) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 backdrop-blur"
    >
      <div
        className="flex flex-col items-center gap-4 rounded-xl border bg-surface px-8 py-7 shadow-2xl"
        style={{ borderColor: "var(--faction)" }}
      >
        <div className="relative h-20 w-20">
          <Image
            src="/LIB_Logo.png"
            alt=""
            width={80}
            height={80}
            priority
            sizes="80px"
            className="h-20 w-20 rounded-full"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-[-6px] rounded-full border-[3px] border-t-transparent animate-spin"
            style={{
              borderColor: "var(--faction-fg)",
              borderTopColor: "transparent",
            }}
          />
        </div>
        <span className="font-display text-base font-bold uppercase tracking-[0.4em] text-foreground">
          Brutally Loading
        </span>
      </div>
    </div>
  );
}
