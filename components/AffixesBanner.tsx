import Image from "next/image";
import type { WeeklyAffixes } from "@/lib/types";

// The affix chips as a standalone row (label + linked chips), no section
// chrome. Used inside the Weekly Keys feed so the week's modifiers sit in
// the same block as the people running them.
export function AffixesRow({ data }: { data: WeeklyAffixes }) {
  if (!data.affixes.length) return null;
  return (
    <div className="flex flex-wrap gap-2.5">
        {data.affixes.map((a) => (
          <a
            key={a.id}
            href={a.wowheadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 transition-colors hover:border-faction"
            title={a.description}
          >
            <Image
              src={a.iconUrl}
              alt=""
              width={22}
              height={22}
              className="rounded shrink-0"
              unoptimized
            />
            <span className="font-display text-sm font-semibold leading-tight">
              {a.name}
            </span>
          </a>
        ))}
    </div>
  );
}
