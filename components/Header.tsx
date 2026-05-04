import Image from "next/image";
import Link from "next/link";
import { GUILD } from "@/lib/config";
import { getGuildSnapshot } from "@/lib/raiderio";
import { MobileNav } from "./MobileNav";
import { RosterSearch } from "./RosterSearch";

const NAV = [
  { href: "/roster", label: "Roster" },
  { href: "/progression", label: "Progression" },
  { href: "/compare", label: "Compare" },
  { href: "/recruit", label: "Recruit" },
  { href: "/about", label: "About" },
];

export async function Header() {
  const snapshot = await getGuildSnapshot();
  const searchEntries = snapshot.roster.map((c) => ({
    name: c.name,
    realmSlug: c.realmSlug,
    class: c.class,
    spec: c.spec,
  }));
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="group flex items-center gap-3">
          <Image
            src="/LIB_Logo.png"
            alt={GUILD.name}
            width={40}
            height={40}
            priority
            className="h-9 w-9 shrink-0 rounded-full sm:h-10 sm:w-10"
          />
          <div className="hidden flex-col leading-tight sm:flex">
            <span className="font-display text-sm font-semibold tracking-wide">
              {GUILD.name}
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted">
              {GUILD.realmDisplay} · {GUILD.regionDisplay}
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 font-display text-xs uppercase tracking-widest text-muted transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            <RosterSearch roster={searchEntries} />
          </div>
          <MobileNav searchEntries={searchEntries} />
        </div>
      </div>
    </header>
  );
}
