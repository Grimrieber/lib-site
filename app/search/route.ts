import { NextResponse } from "next/server";
import { GUILD } from "@/lib/config";

/**
 * Plain GET handler that the header search form falls back to when its
 * client-side onSubmit handler hasn't hydrated yet (or fails). Takes `?q=Name`
 * and redirects to the corresponding character page on the home realm. The
 * RosterSearch client component intercepts in the typical case so this is
 * only hit on no-JS / pre-hydration submits.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const dest = q
    ? `/character/${GUILD.realm}/${encodeURIComponent(q)}`
    : "/";
  return NextResponse.redirect(new URL(dest, url.origin));
}
