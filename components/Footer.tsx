import Image from "next/image";
import { GUILD } from "@/lib/config";

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface/40">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-4 py-8 text-xs text-muted sm:px-6">
        <Image
          src="/LIB_Logo.png"
          alt={GUILD.name}
          width={32}
          height={32}
          className="h-8 w-8 shrink-0 rounded-full"
        />
        <p>
          © {new Date().getFullYear()} {GUILD.name} ·{" "}
          {GUILD.realmDisplay}-{GUILD.regionDisplay}
        </p>
      </div>
    </footer>
  );
}
