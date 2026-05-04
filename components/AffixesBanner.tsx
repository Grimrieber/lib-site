import Image from "next/image";
import type { WeeklyAffixes } from "@/lib/types";

export function AffixesBanner({ data }: { data: WeeklyAffixes }) {
  if (!data.affixes.length) return null;
  return (
    <section className="border-b border-border bg-surface/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:gap-8">
        <p
          className="shrink-0 font-display text-xs uppercase tracking-[0.4em]"
          style={{ color: "var(--faction-fg)" }}
        >
          This Week's Keys
        </p>
        <div className="flex flex-wrap gap-3">
          {data.affixes.map((a) => (
            <a
              key={a.id}
              href={a.wowheadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 transition-colors hover:border-faction"
              title={a.description}
            >
              <Image
                src={a.iconUrl}
                alt=""
                width={28}
                height={28}
                className="rounded shrink-0"
              unoptimized
              />
              <span className="font-display text-sm font-semibold leading-tight">
                {a.name}
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
