import Link from "next/link";
import { OPEN_SPOTS } from "@/lib/content";

export function RecruitingStrip() {
  return (
    <section className="border-b border-border bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p
              className="font-display text-xs uppercase tracking-[0.4em]"
              style={{ color: "var(--faction-fg)" }}
            >
              Now Recruiting
            </p>
            <h2 className="mt-2 font-display text-3xl font-semibold">
              Open Spots
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {OPEN_SPOTS.map((spot) => (
              <div
                key={spot.spec}
                className="rounded-md border border-border bg-background p-4 text-center transition-colors hover:border-faction"
              >
                <p
                  className="font-display text-[10px] uppercase tracking-widest"
                  style={{ color: "var(--faction-fg)" }}
                >
                  {spot.role}
                </p>
                <p className="mt-1 font-display text-sm font-semibold">
                  {spot.spec}
                </p>
              </div>
            ))}
          </div>

          <Link
            href="/recruit"
            className="self-start rounded-md border px-5 py-2.5 font-display text-xs uppercase tracking-widest transition-colors lg:self-center"
            style={{
              borderColor: "var(--faction)",
              color: "var(--faction-fg)",
            }}
          >
            Apply →
          </Link>
        </div>
      </div>
    </section>
  );
}
