import { NextResponse } from "next/server";
import {
  getCharacterAchievementsCached,
  isRosterMember,
} from "@/lib/raiderio";

// Lazy endpoint for the character page's Achievements tab. The tab fetches
// this only when a visitor actually opens it, so the heavy ~2.67MB BNet
// achievements blob is no longer parsed on every character-page render — and
// getCharacterAchievementsCached gates the parse on achievement_points, so even
// an open re-uses the cached summary unless the character earned something new.
export const revalidate = 3600;

export async function GET(
  _: Request,
  { params }: { params: Promise<{ realm: string; name: string }> },
) {
  const { realm, name } = await params;
  const decodedName = decodeURIComponent(name);
  // Reject arbitrary input before the expensive ~2.67MB BNet fetch: only real
  // guild members are valid, which bounds the keyspace and stops a bot from
  // iterating random names to burn CPU + BNet quota.
  if (!(await isRosterMember(realm, decodedName))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const summary = await getCharacterAchievementsCached(realm, decodedName);
  if (!summary) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(summary);
}
