import Image from "next/image";
import Link from "next/link";
import { GUILD } from "@/lib/config";

export const metadata = {
  title: "404 — Lessons in Brutality",
};

const QUOTES = [
  "Got dropped from the raid.",
  "404 — wipe explanation pending.",
  "Pulled too early. Page never spawned.",
  "Lessons learned: the page wasn't there.",
  "Routing pug failed the mechanic.",
];

export default function NotFound() {
  // Render a deterministic-ish "random" line so the build doesn't churn it
  // every render but each user gets one of the rotation. Hour-based pick.
  const quote = QUOTES[new Date().getHours() % QUOTES.length];

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6 sm:py-24">
      <Image
        src="/LIB_Logo.png"
        alt={GUILD.name}
        width={120}
        height={120}
        priority
        sizes="120px"
        className="h-24 w-24 rounded-full sm:h-32 sm:w-32"
      />
      <p
        className="mt-8 font-display text-xs uppercase tracking-[0.4em]"
        style={{ color: "var(--faction-fg)" }}
      >
        404 · Page Not Found
      </p>
      <h1 className="mt-3 font-display text-5xl font-bold sm:text-6xl">
        {quote}
      </h1>
      <p className="mt-6 max-w-md text-base leading-relaxed text-muted">
        Whatever you were looking for either doesn&rsquo;t exist, was renamed,
        or got nuked by an officer. Either way — let&rsquo;s get you back to
        somewhere useful.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-md border-2 px-5 py-2.5 font-display text-xs uppercase tracking-widest transition-colors hover:bg-foreground/5"
          style={{ borderColor: "var(--faction)", color: "var(--faction-fg)" }}
        >
          Home
        </Link>
        <Link
          href="/roster"
          className="rounded-md border border-border px-5 py-2.5 font-display text-xs uppercase tracking-widest text-muted transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          Roster
        </Link>
        <Link
          href="/progression"
          className="rounded-md border border-border px-5 py-2.5 font-display text-xs uppercase tracking-widest text-muted transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          Progression
        </Link>
        <Link
          href="/recruit"
          className="rounded-md border border-border px-5 py-2.5 font-display text-xs uppercase tracking-widest text-muted transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          Recruit
        </Link>
      </div>
    </main>
  );
}
