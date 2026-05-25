"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { GUILD } from "@/lib/config";
import {
  CLASS_COLOR_VAR,
  CLASS_LABEL,
  type Character,
} from "@/lib/types";

type SearchEntry = Pick<Character, "name" | "realmSlug" | "class" | "spec">;

/**
 * Header roster search — type-ahead lookup for jumping to a character page.
 * Matches by case-insensitive name prefix first, then substring; capped at
 * 8 results. Keyboard nav (↑/↓/Enter/Esc) plus click selection.
 */
export function RosterSearch({ roster }: { roster: SearchEntry[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLFormElement>(null);

  // Reset search state on every navigation so the dropdown doesn't linger
  // after the user picks a result. Replaces the old onClick reset that was
  // racing with Next.js Link navigation.
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [pathname]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const prefix: SearchEntry[] = [];
    const contains: SearchEntry[] = [];
    for (const c of roster) {
      const lc = c.name.toLowerCase();
      if (lc.startsWith(q)) prefix.push(c);
      else if (lc.includes(q)) contains.push(c);
    }
    return [...prefix, ...contains].slice(0, 8);
  }, [query, roster]);

  // Reset highlight when matches change so it never points past the list.
  useEffect(() => {
    setHighlight(0);
  }, [matches.length]);

  // Click-outside to close.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function go(c: SearchEntry) {
    setOpen(false);
    setQuery("");
    router.push(`/character/${c.realmSlug}/${encodeURIComponent(c.name)}`);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const top = matches[highlight] ?? matches[0];
    if (top) {
      go(top);
      return;
    }
    // No dropdown match — could be a parked alt off the active roster, or
    // the user's typing the URL fragment directly. Send them to the home
    // realm with the literal name; if invalid the destination 404s cleanly.
    const q = query.trim();
    if (!q) return;
    setOpen(false);
    setQuery("");
    router.push(`/character/${GUILD.realm}/${encodeURIComponent(q)}`);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(matches.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <form
      ref={containerRef}
      onSubmit={onSubmit}
      action="/search"
      method="get"
      className="relative"
    >
      <input
        type="text"
        name="q"
        placeholder="Find a character…"
        value={query}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          // Auto-commit on exact roster-name match. Same pattern as the
          // Compare picker — the moment the typed name fully matches a
          // roster entry, jump to that character page without requiring
          // Enter or a click on the dropdown row.
          const q = next.trim().toLowerCase();
          if (q) {
            const exact = roster.find((c) => c.name.toLowerCase() === q);
            if (exact) go(exact);
          }
        }}
        onFocus={() => query && setOpen(true)}
        onKeyDown={onKey}
        autoComplete="off"
        className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-xs placeholder:text-muted focus:border-faction focus:outline-none md:w-44 md:focus:w-56"
      />
      {open && matches.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-background shadow-lg md:left-auto md:w-64">
          {matches.map((c, i) => (
            <li key={`${c.realmSlug}-${c.name}`}>
              <Link
                href={`/character/${c.realmSlug}/${encodeURIComponent(c.name)}`}
                onMouseEnter={() => setHighlight(i)}
                className={`flex items-baseline justify-between gap-3 px-3 py-2 text-xs transition-colors ${
                  i === highlight ? "bg-surface" : ""
                }`}
              >
                <span
                  className="truncate font-display font-semibold"
                  style={{ color: CLASS_COLOR_VAR[c.class] }}
                >
                  {c.name}
                </span>
                <span className="shrink-0 truncate text-[10px] uppercase tracking-widest text-muted">
                  {c.spec} {CLASS_LABEL[c.class]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
