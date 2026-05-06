"use client";

import Script from "next/script";
import { useState } from "react";
import { DiscordIcon } from "./DiscordIcon";

// Set NEXT_PUBLIC_TURNSTILE_SITE_KEY in Vercel env (and .env.local for dev).
// When unset, the widget doesn't render and the server skips verification —
// honeypot + rate limit still apply. Cloudflare's "always passes" test
// site key for local dev: 1x00000000000000000000AA.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const CLASSES = [
  "Death Knight",
  "Demon Hunter",
  "Druid",
  "Evoker",
  "Hunter",
  "Mage",
  "Monk",
  "Paladin",
  "Priest",
  "Rogue",
  "Shaman",
  "Warlock",
  "Warrior",
];

type Status = "idle" | "submitting" | "success" | "error";

export function RecruitForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Capture the form before any await — React nulls out the synthetic
    // event's currentTarget once the handler returns control to the runtime.
    const form = e.currentTarget;
    setStatus("submitting");
    setError(null);
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const res = await fetch("/api/recruit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("success");
      form.reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-lg border border-faction bg-surface p-8 text-center">
        <div className="flex justify-center">
          <DiscordIcon size={80} />
        </div>
        <h2
          className="mt-4 font-display text-2xl font-semibold"
          style={{ color: "var(--faction-fg)" }}
        >
          Application Submitted
        </h2>
        <p className="mt-3 text-muted">
          Thanks for applying. An officer will reach out on Discord within a
          day or two.
        </p>
        <button
          onClick={() => setStatus("idle")}
          className="mt-6 rounded-md border border-border px-4 py-2 font-display text-xs uppercase tracking-widest text-muted hover:text-foreground"
        >
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Honeypot — bots that auto-fill every form field will populate
          this; legit users never see it. The server drops submissions
          where this is non-empty. Hidden from screen readers + tab order. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      <Field label="Your Name (or handle)" name="applicantName" required />
      <Field
        label="Discord Tag"
        name="discord"
        placeholder="username or username#1234"
        required
      />
      <Field
        label="Battle.net Tag"
        name="battlenet"
        placeholder="optional, e.g. user#1234"
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Character Name"
          name="characterName"
          placeholder="e.g. Kujatas"
          required
        />
        <Field
          label="Realm"
          name="realm"
          placeholder="e.g. Skullcrusher"
          required
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Select label="Class" name="class" options={CLASSES} required />
        <Select
          label="Role"
          name="role"
          options={["Tank", "Healer", "DPS"]}
          required
        />
      </div>

      <Field
        label="Main Spec"
        name="spec"
        placeholder="e.g. Restoration"
        required
      />
      <Field
        label="Off-spec / Secondary"
        name="offspec"
        placeholder="optional"
      />

      <Field
        label="Raider.IO / Warcraft Logs Link"
        name="logs"
        placeholder="https://raider.io/characters/us/skullcrusher/Kujatas"
      />

      <TextArea
        label="Raid Experience"
        name="experience"
        placeholder="Tell us about your recent prog (current tier + difficulty), past tiers, push titles, anything notable…"
        required
      />

      <TextArea
        label="Why LIB?"
        name="why"
        placeholder="What are you looking for? Schedule, social fit, prog goals…"
      />

      {TURNSTILE_SITE_KEY && (
        <>
          {/* Cloudflare Turnstile — verifies the submission is human-driven.
              The widget injects a hidden input with name `cfTurnstileToken`
              into this form, which the server validates via siteverify. */}
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js"
            strategy="afterInteractive"
          />
          <div
            className="cf-turnstile"
            data-sitekey={TURNSTILE_SITE_KEY}
            data-response-field-name="cfTurnstileToken"
            data-theme="dark"
          />
        </>
      )}

      <div className="flex flex-wrap items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={status === "submitting"}
          className="rounded-md px-6 py-3 font-display text-sm uppercase tracking-widest text-foreground transition-transform hover:scale-105 disabled:opacity-60 disabled:hover:scale-100"
          style={{
            background: "var(--faction)",
            boxShadow: "0 0 24px var(--faction-soft)",
          }}
        >
          {status === "submitting" ? "Sending…" : "Submit Application"}
        </button>
        {status === "error" && (
          <p className="text-sm text-red-400">
            Submission failed: {error}. Try Discord directly — see{" "}
            <a href="/about" className="underline">
              About
            </a>
            .
          </p>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-display text-[10px] uppercase tracking-widest text-muted">
        {label}
        {required && <span className="text-faction-fg"> *</span>}
      </span>
      <input
        type="text"
        name={name}
        required={required}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-faction focus:outline-none"
      />
    </label>
  );
}

function Select({
  label,
  name,
  options,
  required,
}: {
  label: string;
  name: string;
  options: string[];
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-display text-[10px] uppercase tracking-widest text-muted">
        {label}
        {required && <span className="text-faction-fg"> *</span>}
      </span>
      <select
        name={name}
        required={required}
        defaultValue=""
        className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-faction focus:outline-none"
      >
        <option value="" disabled>
          Choose…
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextArea({
  label,
  name,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-display text-[10px] uppercase tracking-widest text-muted">
        {label}
        {required && <span className="text-faction-fg"> *</span>}
      </span>
      <textarea
        name={name}
        required={required}
        placeholder={placeholder}
        rows={4}
        className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-faction focus:outline-none"
      />
    </label>
  );
}
