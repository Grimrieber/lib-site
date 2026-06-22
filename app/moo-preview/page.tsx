import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MOO_CAPTION_DB } from "@/lib/moo-captions";
import { getBoobRender, getRandomCowUrl } from "@/lib/moo";

/**
 * Throwaway design-preview route for the proposed #only-moo daily-cow channel.
 * Renders the Discord embed exactly as the client would paint it, using the
 * hand-verified cows in lib/moo-cows.ts (curated from Wikimedia Commons). The
 * site CSP's img-src doesn't whitelist upload.wikimedia.org, so we fetch each
 * cow SERVER-side and inline it as a data: URI (which CSP allows) rather than
 * loosen the production policy for a throwaway page. Refresh to rotate cows.
 * Nothing is wired to a webhook yet; this is purely to judge the look before
 * the channel is made. Not linked from nav; noindex. Delete once signed off.
 *
 * (The real feature posts to Discord, which ignores the site CSP — so none of
 * this data-URI plumbing is needed there; a plain image URL works.)
 */

export const metadata: Metadata = {
  title: "Only Moo — Preview",
  robots: { index: false, follow: false },
};

// Re-fetch on every page load so a refresh shows new cows.
export const dynamic = "force-dynamic";

const GUILD = "Lessons in Brutality";

// Discord client palette (matches /discord-preview)
const C = {
  page: "#313338",
  embed: "#2b2d31",
  white: "#f2f3f5",
  body: "#dbdee1",
  muted: "#949ba4",
};

// Pasture green stripe — reads as "the moo thing" at a glance, distinct from
// the guild-feed event colors.
const MOO = "#6aa84f";

// Fetch a curated Commons cow server-side (CSP blocks the host in the browser)
// and inline it as a data URI so it renders on this preview page.
async function fetchCow(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, {
      cache: "no-store",
      signal: ctrl.signal,
      headers: { "User-Agent": "lib-site-moo/0.1 (preview)" },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "image/jpeg";
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// Render a Discord-style @mention chip (light text on translucent blurple).
function Mention({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        color: "#c9cdfb",
        background: "rgba(88,101,242,0.32)",
        borderRadius: 3,
        padding: "0 2px",
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

// Render a caption with {boob}/{kuja} tokens as mention chips, matching what
// renderCaption() produces for the real Discord post.
function CaptionText({ text }: { text: string }) {
  const parts = text.split(/(\{boob\}|\{kuja\})/g);
  return (
    <>
      {parts.map((p, i) =>
        p === "{boob}" ? (
          <Mention key={i}>@ZamboniBoob</Mention>
        ) : p === "{kuja}" ? (
          <Mention key={i}>@Kujatas</Mention>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function MooMessage({
  img,
  caption,
  timestamp,
}: {
  img: string | null;
  caption: string;
  timestamp: string;
}) {
  return (
    <div style={{ display: "flex", gap: 16, padding: "2px 0 18px" }}>
      {/* Webhook avatar as an emoji badge: dark circle + pasture-green ring */}
      <div
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: "50%",
          background: "#1e1f22",
          border: `2px solid ${MOO}`,
          boxShadow: `0 0 0 1px #00000040, 0 0 10px -2px ${MOO}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          lineHeight: 1,
        }}
      >
        <span aria-hidden>🐄</span>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span style={{ color: C.white, fontSize: 16, fontWeight: 600 }}>
            Daily Moo
          </span>
          <span
            style={{
              background: "#5865f2",
              color: "#fff",
              fontSize: 10,
              fontWeight: 600,
              padding: "1px 4px",
              borderRadius: 4,
              textTransform: "uppercase",
              letterSpacing: 0.3,
            }}
          >
            App
          </span>
          <span style={{ color: C.muted, fontSize: 12 }}>{timestamp}</span>
        </div>

        {/* embed */}
        <div
          style={{
            maxWidth: 432,
            background: C.embed,
            borderRadius: 4,
            borderLeft: `4px solid ${MOO}`,
            padding: "10px 16px 16px 12px",
            fontFamily: "'gg sans','Noto Sans',Helvetica,Arial,sans-serif",
          }}
        >
          <div
            style={{
              color: C.white,
              fontSize: 16,
              fontWeight: 700,
              marginTop: 4,
              lineHeight: 1.3,
            }}
          >
            🐄 DAILY MOO
          </div>
          <div
            style={{
              color: C.body,
              fontSize: 14,
              marginTop: 4,
              lineHeight: 1.4,
            }}
          >
            <CaptionText text={caption} />
          </div>

          {/* large image — Discord renders the embed `image` big, below text */}
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img}
              alt="a cow"
              style={{
                display: "block",
                width: "100%",
                maxWidth: 400,
                borderRadius: 8,
                marginTop: 12,
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                maxWidth: 400,
                height: 240,
                borderRadius: 8,
                marginTop: 12,
                background: "#1e1f22",
                color: C.muted,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              🐄 cow failed to load — refresh
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <span style={{ color: C.muted, fontSize: 12 }}>
              {GUILD} · #only-moo • {timestamp}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function MooPreviewPage() {
  // Throwaway design preview — dev-only. In production it's a 404 (before any
  // upstream fetch) so it adds zero public bot surface / Active CPU, while
  // staying usable under `next dev` for the unshipped #only-moo design work.
  if (process.env.NODE_ENV === "production") notFound();
  const stamps = ["Today at 9:00 AM", "Today at 9:00 PM", "Yesterday"];
  const renderCaps = MOO_CAPTION_DB.filter((c) =>
    c.tags?.includes("render"),
  ).map((c) => c.text);
  const cowCaps = MOO_CAPTION_DB.filter(
    (c) => !c.tags?.includes("render"),
  ).map((c) => c.text);
  const renderCap = [...renderCaps].sort(() => Math.random() - 0.5)[0];
  const cowCapShuf = [...cowCaps].sort(() => Math.random() - 0.5);
  // Cows are pulled LIVE from Commons breed categories (effectively unlimited),
  // his render LIVE from BNet (tracks transmog). Cow URLs are then inlined as
  // data URIs because the site CSP doesn't whitelist upload.wikimedia.org.
  const [render, cowUrl1, cowUrl2] = await Promise.all([
    getBoobRender(),
    getRandomCowUrl(),
    getRandomCowUrl(),
  ]);
  const cowImgs = await Promise.all([cowUrl1, cowUrl2].map((u) => fetchCow(u)));

  // One "the man himself" render post (his Tauren in yellow) + two cows. The
  // render is CSP-whitelisted (render.worldofwarcraft.com) so it's a direct
  // URL; cows are CSP-blocked, so they're the inlined data URIs.
  const posts = [
    { img: render, caption: renderCap, timestamp: stamps[0] },
    { img: cowImgs[0], caption: cowCapShuf[0], timestamp: stamps[1] },
    { img: cowImgs[1], caption: cowCapShuf[1], timestamp: stamps[2] },
  ];

  return (
    <div
      style={{
        background: C.page,
        minHeight: "100vh",
        padding: "32px 20px 80px",
        fontFamily: "'gg sans','Noto Sans',Helvetica,Arial,sans-serif",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ color: C.white, fontSize: 22, fontWeight: 700, margin: 0 }}>
          # only-moo — daily cow preview
        </h1>
        <p style={{ color: "#b5bac1", fontSize: 14, marginTop: 8 }}>
          Twice a day, posted under a 🐄 webhook avatar with a pasture-green
          stripe. Each post pairs an image with a caption. Cows are pulled{" "}
          <strong style={{ color: C.body }}>live from Wikimedia Commons</strong>{" "}
          breed categories (Highland cattle &amp; friends) — effectively
          unlimited, no manual upkeep — plus, now and then,{" "}
          <strong style={{ color: C.body }}>the man himself</strong>:
          MeatSupreme&rsquo;s actual Tauren Paladin render in full yellow
          pajamas (first post below). Captions are self-replenishing too —{" "}
          {MOO_CAPTION_DB.length} curated lines, a combinatorial generator, and
          live Raider.IO stat/recent-key lines — all affectionate{" "}
          <strong style={{ color: C.body }}>@ZamboniBoob</strong> ribbing:
          cow jokes, standing in fire, the yellow jammies, the raid refusing to
          heal him.{" "}
          <strong style={{ color: C.body }}>Refresh to roll new pairs.</strong>{" "}
          Nothing is wired to a webhook yet.
        </p>

        <div style={{ marginTop: 24 }}>
          {posts.map((p, i) => (
            <MooMessage
              key={i}
              img={p.img}
              caption={p.caption}
              timestamp={p.timestamp}
            />
          ))}
        </div>

        <p
          style={{
            color: C.muted,
            fontSize: 13,
            marginTop: 28,
            lineHeight: 1.5,
          }}
        >
          To ship: make the <code style={{ color: C.body }}>#only-moo</code>{" "}
          channel, add a webhook, set{" "}
          <code style={{ color: C.body }}>DISCORD_WEBHOOK_MOO</code>, and a
          twice-a-day job hits{" "}
          <code style={{ color: C.body }}>/api/moo</code>, which builds the post
          itself. ~2 fetches + 1 POST per run — negligible CPU. (Discord fetches
          the image URL itself and ignores the site CSP — the data-URI trick
          here is only to render cows on this preview page.) Nothing here needs
          manual upkeep: cows, captions, his render, and his stats are all
          pulled live.
        </p>
      </div>
    </div>
  );
}
