import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <Skeleton className="h-3 w-24" />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <Skeleton className="h-12 w-40" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="mt-3 h-4 w-96" />

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}
