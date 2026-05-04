"use client";

import { useEffect, useState } from "react";

type TabKey = "raids" | "dungeons" | "achievements" | "collections" | "pvp";

const TABS: { key: TabKey; label: string }[] = [
  { key: "raids", label: "Raids" },
  { key: "dungeons", label: "Dungeons" },
  { key: "achievements", label: "Achievements" },
  { key: "collections", label: "Collections" },
  { key: "pvp", label: "PVP" },
];

const VALID = new Set<TabKey>(TABS.map((t) => t.key));

function readHash(): TabKey {
  if (typeof window === "undefined") return "raids";
  const h = window.location.hash.replace("#", "");
  return VALID.has(h as TabKey) ? (h as TabKey) : "raids";
}

/**
 * Client-side tab switcher. All tab content is server-rendered and passed in
 * as slot props — the client just toggles which one is visible. No server
 * roundtrip per tab click; switching is instant.
 *
 * Active tab is tracked in the URL hash (#dungeons, #pvp, etc.) so it's
 * shareable and survives refresh. Hash changes don't trigger Next.js
 * navigation, so this stays purely client-side.
 */
export function CharacterTabsClient({
  raids,
  dungeons,
  achievements,
  collections,
  pvp,
}: {
  raids: React.ReactNode;
  dungeons: React.ReactNode;
  achievements: React.ReactNode;
  collections: React.ReactNode;
  pvp: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("raids");

  // On mount, read the URL hash to support deep-linked tabs.
  useEffect(() => {
    setActiveTab(readHash());
    function onHash() {
      setActiveTab(readHash());
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function selectTab(key: TabKey) {
    setActiveTab(key);
    // Update the URL hash without scroll-jumping or triggering navigation.
    const newHash = key === "raids" ? "" : `#${key}`;
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search + newHash,
    );
  }

  const content: Record<TabKey, React.ReactNode> = {
    raids,
    dungeons,
    achievements,
    collections,
    pvp,
  };

  return (
    <>
      <nav
        className="-mx-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => selectTab(tab.key)}
              className={`shrink-0 cursor-pointer rounded-t px-3 py-2.5 font-display text-xs uppercase tracking-widest transition-colors sm:px-4 ${
                isActive
                  ? "border-b-2 text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
              style={
                isActive
                  ? {
                      borderBottomColor: "var(--faction)",
                      marginBottom: "-1px",
                    }
                  : undefined
              }
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-6">{content[activeTab]}</div>
    </>
  );
}
