"use client";

import { useEffect } from "react";

/**
 * Mounted by every page (or, for routes with Suspense-deferred data, by
 * the inner async content) to signal that the page has actually committed.
 *
 * The global NavLoadingOverlay listens for `lib:nav-ready` and hides
 * itself when received. Without this signal it has to fall back to
 * pathname-change detection — which fires too early in App Router
 * transitions because `usePathname()` updates eagerly while the visible
 * UI is still on the previous route.
 */
export function NavReady() {
  useEffect(() => {
    window.dispatchEvent(new Event("lib:nav-ready"));
  }, []);
  return null;
}
