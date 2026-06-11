import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { GUILD } from "@/lib/config";
import { getGuildSnapshot } from "@/lib/raiderio";

export const alt =
  "Lessons in Brutality — Skullcrusher (US-Alliance) Mythic/Heroic-progression raiding guild";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Cache the rendered PNG for an hour instead of re-running Satori per
// request. The image is derived from the bundled snapshot, which now
// resolves instantly (getGuildSnapshot is a build-time read), so the old
// build-time-timeout reason for force-dynamic no longer applies. With ISR,
// Vercel's CDN serves one cached PNG per hour — every Discord/Slack unfurl
// and crawler hit reuses it instead of paying a fresh Satori render. The
// hourly redeploy regenerates it, so the card stays as fresh as before.
export const revalidate = 3600;

// Read the logo file once per cold start and reuse for all OG renders.
// Satori (the OG renderer) can fetch via HTTP but Vercel's serverless
// internals can't always self-fetch their own deployment URL reliably,
// which left the logo missing on the live OG card. Reading from the
// deployment filesystem is bulletproof.
let cachedLogoDataUrl: string | null = null;
async function getLogoDataUrl(): Promise<string | null> {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;
  try {
    const buf = await readFile(
      path.join(process.cwd(), "public", "LIB_Logo.png"),
    );
    cachedLogoDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
    return cachedLogoDataUrl;
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const [snap, logoDataUrl] = await Promise.all([
    getGuildSnapshot().catch(() => null),
    getLogoDataUrl(),
  ]);
  const mythic = snap?.tiers.find((t) => t.difficulty === "Mythic");
  const heroic = snap?.tiers.find((t) => t.difficulty === "Heroic");
  const tierLabel = snap?.tierExpansionName ?? "Current Tier";

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
        {logoDataUrl && (
          <img
            src={logoDataUrl}
            width={420}
            height={420}
            style={{ borderRadius: "50%", flexShrink: 0 }}
          />
        )}
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
