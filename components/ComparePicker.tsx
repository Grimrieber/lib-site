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

  function submit(nextA = a, nextB = b) {
    const params = new URLSearchParams();
    if (nextA) params.set("a", nextA);
    if (nextB) params.set("b", nextB);
    router.push(`/compare?${params.toString()}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <PickerInput
        label="Character A"
        roster={roster}
        value={a}
        onChange={setA}
        onPick={(name) => {
          setA(name);
          submit(name, b);
        }}
      />
      <PickerInput
        label="Character B"
        roster={roster}
        value={b}
        onChange={setB}
        onPick={(name) => {
          setB(name);
          submit(a, name);
        }}
      />
    </form>
  );
}

function PickerInput({
  label,
  roster,
  value,
  onChange,
  onPick,
}: {
  label: string;
  roster: Entry[];
  value: string;
  onChange: (v: string) => void;
  onPick: (name: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    const prefix: Entry[] = [];
    const contains: Entry[] = [];
    for (const c of roster) {
      const lc = c.name.toLowerCase();
      if (lc === q) continue;
      if (lc.startsWith(q)) prefix.push(c);
      else if (lc.includes(q)) contains.push(c);
    }
    return [...prefix, ...contains].slice(0, 6);
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
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay close so click on suggestion fires.
          setTimeout(() => setOpen(false), 150);
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
                onClick={() => onPick(m.name)}
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
