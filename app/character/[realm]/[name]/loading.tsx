import { Skeleton } from "@/components/Skeleton";

/**
 * Shown while the character layout's `getCharacterDetail()` resolves.
 * Mirrors the full final structure (hero + loadout + tabs + tab body) so
 * when real content commits there's minimal layout shift.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        {/* Hero */}
        <div className="border-b border-border p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <Skeleton className="h-14 w-14 rounded-lg sm:h-16 sm:w-16" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-7 w-48 sm:h-9 sm:w-64" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
            <div className="flex gap-5 sm:ml-auto">
              <Skeleton className="h-6 w-14" />
              <Skeleton className="h-6 w-14" />
              <Skeleton className="h-6 w-14" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>

        {/* Loadout block — rough shape of the gear/stats grid + talents */}
        <div className="p-4 sm:p-5">
          <Skeleton className="h-3 w-20" />
          <div className="mt-3 hidden gap-4 lg:grid lg:grid-cols-[1fr_280px_1fr]">
            <div className="space-y-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
            <Skeleton className="h-64 w-full" />
            <div className="space-y-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          </div>
          <div className="mt-3 lg:hidden space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
          <Skeleton className="mt-4 h-40 w-full" />
        </div>
      </section>

      {/* Tab nav */}
      <div className="mt-8 flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>

      {/* Tab body — raids list */}
      <div className="mt-6 space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}
