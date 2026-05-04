import type { CharacterDetail } from "@/lib/types";

export function CollectionsTabContent({ detail }: { detail: CharacterDetail }) {
  const c = detail.collections;
  if (!c) {
    return <p className="text-muted">Collections unavailable.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <CollectionCard label="Mounts" count={c.mountCount} />
      <CollectionCard label="Pets" count={c.petCount} />
    </div>
  );
}

function CollectionCard({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-md border border-border bg-surface p-5">
      <p className="font-display text-xs uppercase tracking-widest text-muted">
        {label}
      </p>
      <p
        className="mt-1 font-display text-5xl font-bold tabular-nums"
        style={{ color: "var(--faction-fg)" }}
      >
        {count.toLocaleString()}
      </p>
      <p className="mt-1 text-xs text-muted">
        unique {label.toLowerCase()} collected
      </p>
    </div>
  );
}
