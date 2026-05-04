"use client";

import { useEffect } from "react";

/**
 * Mounted at the root of resolved character page content (after the
 * Suspense'd async data has loaded). Two side-effects on mount:
 *  1. Scroll to (0,0) — Next.js App Router's auto-scroll can land mid-page
 *     when streaming Suspense boundaries grow the page below the viewport.
 *  2. Dispatch the `lib:nav-ready` event so the global NavLoadingOverlay
 *     knows the new route has fully committed its real content (not the
 *     skeleton) and can hide. Without this signal, the overlay relies on
 *     pathname-change detection, which fires too early in App Router
 *     transitions — pathname updates before React actually swaps the
 *     visible UI off the previous route.
 */
export function ScrollToTopOnMount() {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    window.dispatchEvent(new Event("lib:nav-ready"));
  }, []);
  return null;
}
