import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <Skeleton className="h-3 w-24" />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="mt-3 h-4 w-96" />

      <div className="mt-10 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}
