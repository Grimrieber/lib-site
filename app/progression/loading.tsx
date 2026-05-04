import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-12 w-64" />
      <Skeleton className="mt-3 h-4 w-96" />

      <div className="mt-10 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}
