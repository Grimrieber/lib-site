"use client";

import { useState } from "react";

export function CopyButton({
  value,
  label = "Copy build",
  successLabel = "Copied!",
  className,
}: {
  value: string;
  label?: string;
  successLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked; fail silently.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={
        className ??
        "rounded border border-border px-2.5 py-1 font-display text-[10px] uppercase tracking-widest text-muted transition-colors hover:border-faction hover:text-foreground"
      }
    >
      {copied ? successLabel : label}
    </button>
  );
}
