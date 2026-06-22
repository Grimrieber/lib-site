"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { CLASS_COLOR_VAR, type WowClass } from "@/lib/types";

type Entry = {
  name: string;
  realmSlug: string;
  class: WowClass;
  spec: string;
};

export function ComparePicker({
  roster,
  initialA,
  initialB,
}: {
  roster: Entry[];
  initialA: string;
  initialB: string;
}) {
  const router = useRouter();
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);

  function run(nextA: string, nextB: string) {
    const params = new URLSearchParams();
    if (nextA) params.set("a", nextA);
    if (nextB) params.set("b", nextB);
    router.push(`/compare?${params.toString()}`);
  }

  // Fill a field, then run the comparison ONLY once BOTH names are set. This is
  // the key fix: selecting the first character (by typing it out, clicking,
  // Enter, or Tab) must not navigate away before the second can be entered.
  function completeA(name: string) {
    setA(name);
    if (b.trim()) run(name, b);
  }
  function completeB(name: string) {
    setB(name);
    if (a.trim()) run(a, name);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (a.trim() && b.trim()) run(a, b);
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <PickerInput
        label="Character A"
        roster={roster}
        value={a}
        onChange={setA}
        onComplete={completeA}
      />
      <PickerInput
        label="Character B"
        roster={roster}
        value={b}
        onChange={setB}
        onComplete={completeB}
      />
    </form>
  );
}

function PickerInput({
  label,
  roster,
  value,
  onChange,
  onComplete,
}: {
  label: string;
  roster: Entry[];
  value: string;
  onChange: (v: string) => void;
  /** Fill this field with a chosen roster name. Runs the comparison only when
   *  the other field is already set (decided by the parent). */
  onComplete: (name: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    const exact: Entry[] = [];
    const prefix: Entry[] = [];
    const contains: Entry[] = [];
    for (const c of roster) {
      const lc = c.name.toLowerCase();
      // Keep exact matches pinned at the top so Enter / Tab / click commits the
      // intended character without the dropdown vanishing on full type.
      if (lc === q) exact.push(c);
      else if (lc.startsWith(q)) prefix.push(c);
      else if (lc.includes(q)) contains.push(c);
    }
    return [...exact, ...prefix, ...contains].slice(0, 6);
  }, [value, roster]);

  return (
    <div className="relative">
      <label
        htmlFor={id}
        className="font-display text-[10px] uppercase tracking-widest text-muted"
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next);
          setOpen(true);
          // Auto-fill the instant the typed text is an exact roster name. This
          // only FILLS the field; the parent runs the comparison once both
          // fields are set — so finishing the first name no longer navigates.
          const q = next.trim().toLowerCase();
          if (q) {
            const exact = roster.find((c) => c.name.toLowerCase() === q);
            if (exact) {
              onComplete(exact.name);
              setOpen(false);
            }
          }
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay close so a click on a suggestion fires first.
          setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (matches.length === 0) return;
          if (e.key === "Enter") {
            // Enter commits the top suggestion (intercepts the form submit so a
            // partial name + Enter resolves to the best match).
            e.preventDefault();
            onComplete(matches[0].name);
            setOpen(false);
          } else if (e.key === "Tab" && open) {
            // Tab completes this field to the top suggestion — same as clicking
            // it — and lets focus advance to the next field. No preventDefault:
            // the comparison only runs once BOTH fields are set, so Tab fills A
            // and moves you to B rather than navigating away.
            onComplete(matches[0].name);
            setOpen(false);
          }
        }}
        placeholder="Type a name…"
        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 font-display text-sm placeholder:text-muted focus:border-faction focus:outline-none"
      />
      {open && matches.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          {matches.map((m) => (
            <li key={`${m.realmSlug}-${m.name}`}>
              <button
                type="button"
                onClick={() => {
                  onComplete(m.name);
                  setOpen(false);
                }}
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left transition-colors hover:bg-background/60"
              >
                <span
                  className="font-display text-sm font-semibold"
                  style={{ color: CLASS_COLOR_VAR[m.class] }}
                >
                  {m.name}
                </span>
                <span className="text-xs text-muted">{m.spec}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
