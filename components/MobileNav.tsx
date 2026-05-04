"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { RosterSearch } from "./RosterSearch";
import type { Character } from "@/lib/types";

const NAV = [
  { href: "/roster", label: "Roster" },
  { href: "/progression", label: "Progression" },
  { href: "/compare", label: "Compare" },
  { href: "/recruit", label: "Recruit" },
  { href: "/about", label: "About" },
];

type SearchEntry = Pick<Character, "name" | "realmSlug" | "class" | "spec">;

export function MobileNav({
  searchEntries,
}: {
  searchEntries: SearchEntry[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll when menu open.
  useEffect(() => {
    if (open) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface md:hidden"
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>

      {open && (
        <div
          className="fixed inset-x-0 top-16 z-30 border-b border-border bg-background/95 backdrop-blur md:hidden"
          onClick={() => setOpen(false)}
        >
          <div className="mx-auto max-w-7xl px-4 py-3">
            <div onClick={(e) => e.stopPropagation()}>
              <RosterSearch roster={searchEntries} />
            </div>
            <nav className="mt-2">
              <ul className="flex flex-col">
                {NAV.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`block rounded-md px-3 py-3 font-display text-sm uppercase tracking-widest transition-colors ${
                          isActive
                            ? "text-foreground"
                            : "text-muted hover:text-foreground"
                        }`}
                        style={
                          isActive
                            ? { color: "var(--faction-fg)" }
                            : undefined
                        }
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

function MenuIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
