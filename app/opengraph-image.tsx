import { ImageResponse } from "next/og";
import { GUILD } from "@/lib/config";
import { getGuildSnapshot } from "@/lib/raiderio";

export const alt =
  "Lessons in Brutality — Skullcrusher (US-Alliance) heroic-progression raiding guild";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Regenerate at most every 30 minutes — matches the snapshot cache window
// and the Vercel cron warmup cadence. Keeps share thumbnails reasonably
// fresh without paying the snapshot cost on every Discord/Twitter request.
export const revalidate = 1800;

export default async function OpengraphImage() {
  const snap = await getGuildSnapshot().catch(() => null);
  const mythic = snap?.tiers.find((t) => t.difficulty === "Mythic");
  const heroic = snap?.tiers.find((t) => t.difficulty === "Heroic");
  const tierLabel = snap?.tierExpansionName ?? "Current Tier";

  // Logo lives in /public — needs an absolute URL because Satori (the
  // OG renderer) can't resolve relative paths.
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const logoUrl = `${baseUrl}/LIB_Logo.png`;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(135deg, #050505 0%, #0a0a0a 50%, #1a0606 100%)",
          padding: 70,
          alignItems: "center",
          gap: 64,
          color: "#ffffff",
        }}
      >
        <img
          src={logoUrl}
          width={420}
          height={420}
          style={{ borderRadius: "50%", flexShrink: 0 }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            flex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 22,
              color: "#a8c8e8",
              letterSpacing: "0.35em",
              textTransform: "uppercase",
            }}
          >
            {GUILD.realmDisplay} · {GUILD.regionDisplay}-Alliance
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 88,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.01em",
            }}
          >
            Lessons in Brutality
          </div>
          <div
            style={{
              display: "flex",
              gap: 28,
              marginTop: 18,
              alignItems: "baseline",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 28,
                color: "#9d9d9d",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
              }}
            >
              {tierLabel}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 28,
              marginTop: 4,
              alignItems: "baseline",
            }}
          >
            {heroic && heroic.totalBosses > 0 && (
              <div
                style={{
                  display: "flex",
                  fontSize: 56,
                  fontWeight: 700,
                  color: "#a335ee",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {heroic.killed}/{heroic.totalBosses} H
              </div>
            )}
            {mythic && mythic.totalBosses > 0 && (
              <div
                style={{
                  display: "flex",
                  fontSize: 56,
                  fontWeight: 700,
                  color: "#ff8000",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {mythic.killed}/{mythic.totalBosses} M
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
