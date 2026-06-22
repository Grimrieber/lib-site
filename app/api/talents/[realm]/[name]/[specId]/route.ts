import { NextResponse } from "next/server";
import { getCharacterSpecTalents } from "@/lib/battlenet";
import { isRosterMember } from "@/lib/raiderio";

export const revalidate = 3600;

export async function GET(
  _: Request,
  {
    params,
  }: {
    params: Promise<{ realm: string; name: string; specId: string }>;
  },
) {
  const { realm, name, specId } = await params;
  const numericSpecId = parseInt(specId, 10);
  if (!Number.isFinite(numericSpecId)) {
    return NextResponse.json({ error: "invalid specId" }, { status: 400 });
  }
  const decodedName = decodeURIComponent(name);
  // Bound to real guild members before the upstream BNet fetch — same anti-
  // amplification guard as the achievements proxy.
  if (!(await isRosterMember(realm, decodedName))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const result = await getCharacterSpecTalents(
    realm,
    decodedName,
    numericSpecId,
  );
  if (!result) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
