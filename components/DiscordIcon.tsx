"use client";

/**
 * Renders the guild's Discord server icon. The image file is expected at
 * `/public/discord-icon.png`. If missing, the component renders nothing
 * (the onError hides the broken image gracefully).
 */
export function DiscordIcon({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/discord-icon.png"
      alt="Discord"
      width={size}
      height={size}
      className="rounded-full border border-faction"
      style={{ width: size, height: size }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}
