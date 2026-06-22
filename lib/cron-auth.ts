import { NextResponse } from "next/server";

/**
 * Shared bearer-token gate for the cron / automation routes (snapshot-export,
 * snapshot-enrichments, announce, moo, moo-events).
 *
 * Returns `null` when the request is authorized — callers do
 * `const denied = requireCronAuth(req); if (denied) return denied;`.
 *
 * FAIL-CLOSED IN PRODUCTION. Previously each route allowed unauthenticated
 * access whenever its secret was unset ("dev convenience"). That meant a single
 * cleared/typo'd env var in production would silently open posting + export
 * routes to the public (Discord spam, expensive exports). Now an unset secret
 * is only permitted in local dev (NODE_ENV !== "production"); in production a
 * missing secret denies, so a misconfiguration fails safe instead of open.
 */
export function requireCronAuth(
  req: Request,
  expected: string | undefined = process.env.CRON_SECRET,
): NextResponse | null {
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      // Misconfigured in prod — deny rather than expose the route.
      return NextResponse.json(
        { error: "server auth misconfigured" },
        { status: 401 },
      );
    }
    return null; // local dev: allow unauthenticated
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
