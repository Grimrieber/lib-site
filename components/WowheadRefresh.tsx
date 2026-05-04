"use client";

import { useEffect } from "react";

/**
 * Wowhead's Power tooltip script (loaded globally via app/layout.tsx) only
 * scans the DOM for `data-wowhead` attributes once on initial page load.
 * Client-side navigation in Next.js App Router doesn't trigger that scan
 * again, so tooltips silently stop working on routes navigated to via
 * <Link>.
 *
 * This component listens for the `lib:nav-ready` event (dispatched by
 * route layouts when their resolved content commits) and re-invokes
 * `$WowheadPower.refreshLinks()` to pick up the new tooltip targets.
 */
export function WowheadRefresh() {
  useEffect(() => {
    function refresh() {
      const wh = (window as unknown as {
        $WowheadPower?: { refreshLinks?: () => void };
      }).$WowheadPower;
      // Defer to next frame so the DOM has settled after the route commit.
      requestAnimationFrame(() => {
        try {
          wh?.refreshLinks?.();
        } catch {
          // Wowhead script not ready yet on first render — that's fine,
          // initial scan handles it. Subsequent nav-ready events will hit.
        }
      });
    }
    window.addEventListener("lib:nav-ready", refresh);
    return () => window.removeEventListener("lib:nav-ready", refresh);
  }, []);
  return null;
}
