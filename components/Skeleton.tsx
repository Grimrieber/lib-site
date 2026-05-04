/**
 * Animated placeholder primitive for loading states. Tailwind's animate-pulse
 * handles the shimmer; consumers compose multiple Skeletons to match the
 * layout of whatever's loading.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-surface ${className}`}
      aria-hidden
    />
  );
}
