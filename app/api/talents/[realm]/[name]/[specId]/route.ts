import { NextResponse } from "next/server";
import { getCharacterSpecTalents } from "@/lib/battlenet";

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
  const result = await getCharacterSpecTalents(
    realm,
    decodeURIComponent(name),
    numericSpecId,
  );
  if (!result) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
