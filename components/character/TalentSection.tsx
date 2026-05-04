import { TalentBlock } from "./TalentBlock";
import { getCharacterTalents } from "@/lib/battlenet";

/**
 * Server component that fetches talents independently of the main character
 * detail. Wrapped in a Suspense boundary in Profile.tsx so the page can
 * commit gear/stats/tabs immediately while talent icon resolution streams
 * in. Only the active spec is fully resolved here; off-specs stream their
 * arrays on demand via /api/talents/<realm>/<name>/<specId>.
 */
export async function TalentSection({
  realmSlug,
  characterName,
}: {
  realmSlug: string;
  characterName: string;
}) {
  const talents = await getCharacterTalents(realmSlug, characterName);
  if (!talents) return null;
  return (
    <div className="mt-4">
      <TalentBlock
        talents={talents}
        realmSlug={realmSlug}
        characterName={characterName}
      />
    </div>
  );
}

export function TalentSectionSkeleton() {
  return (
    <div className="mt-4">
      <div className="rounded-md border border-border bg-surface/50 p-4">
        <div className="h-3 w-24 animate-pulse rounded bg-border/60" />
        <div className="mt-3 h-44 w-full animate-pulse rounded bg-border/30" />
      </div>
    </div>
  );
}
