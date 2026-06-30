import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 *
 *  - HSTS                 — force HTTPS once you've shipped on a real domain.
 *  - X-Frame-Options DENY — block embedding the site in an iframe (clickjacking).
 *  - X-Content-Type-Options nosniff — prevent MIME sniffing.
 *  - Referrer-Policy strict-origin-when-cross-origin — don't leak full URLs.
 *  - Permissions-Policy — disable APIs we don't use (camera/mic/geo/etc.).
 *  - Content-Security-Policy — restrict where scripts/images/styles can load
 *    from. Allows our image CDNs + the zamimg power.js widget script.
 */
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Wowhead Power widget loads its own dependent scripts from various
      // zamimg/wowhead subdomains. Allow the whole subdomain tree so the
      // tooltip script's lazy fetches don't get blocked.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.zamimg.com https://*.wowhead.com",
      // Wowhead's tooltip widget loads its own stylesheet for popup
      // positioning + theme. Needs the same wildcards as script-src.
      "style-src 'self' 'unsafe-inline' https://*.zamimg.com https://*.wowhead.com",
      // All allowed remote image origins. Wowhead tooltip popups load
      // icons from various zamimg subdomains.
      "img-src 'self' data: blob: https://render.worldofwarcraft.com https://*.zamimg.com https://*.wowhead.com https://cdn.raiderio.net https://cdn.discordapp.com https://upload.wikimedia.org",
      "font-src 'self' data:",
      // Wowhead tooltip XHRs go to www.wowhead.com / nether.wowhead.com /
      // various subdomains. Wildcards keep us future-proof if they shift.
      "connect-src 'self' https://*.wowhead.com https://*.zamimg.com",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "render.worldofwarcraft.com" },
      { protocol: "https", hostname: "cdn.raiderio.net" },
      { protocol: "https", hostname: "wow.zamimg.com" },
    ],
  },
  async headers() {
    // Static, snapshot-derived routes (home, roster/about/recruit, and the
    // OG/Twitter cards) only change on redeploy — which happens hourly via
    // the refresh cron — so a shared cache can serve them. Repeat visits and
    // social unfurls reuse a cached copy instead of paying a round-trip.
    // The ≤5-min HTML window is invisible because the data itself only moves
    // hourly. Everything else (live character/compare/progression pages, all
    // /api/* routes, auth) keeps `private, no-cache` and is never shared-cached.
    const STATIC_HTML_CACHE =
      "public, s-maxage=300, stale-while-revalidate=3600";
    const IMAGE_CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Dynamic HTML + API + auth: revalidate on every direct navigation so
        // users never see stale live data, and never shared-cache. `no-cache`
        // (not `no-store`) keeps bf-cache eligible so Back/Forward restores
        // instantly. The negative-lookahead excludes /_next/* and any path
        // with a file extension (static assets keep long cache lifetimes),
        // plus the handful of static snapshot routes handled by the rules
        // below — so no path ever matches two Cache-Control rules.
        source:
          "/((?!_next/|.*\\.[a-zA-Z0-9]+$|(?:roster|about|recruit|opengraph-image|twitter-image)$|$).*)",
        headers: [{ key: "Cache-Control", value: "private, no-cache" }],
      },
      {
        // Home page (static, regenerates hourly on redeploy).
        source: "/",
        headers: [{ key: "Cache-Control", value: STATIC_HTML_CACHE }],
      },
      {
        // Static snapshot-derived pages.
        source: "/(roster|about|recruit)",
        headers: [{ key: "Cache-Control", value: STATIC_HTML_CACHE }],
      },
      {
        // OG/Twitter PNGs: cache the rendered card for an hour so unfurls
        // reuse it instead of re-fetching the bytes every time.
        source: "/(opengraph-image|twitter-image)",
        headers: [{ key: "Cache-Control", value: IMAGE_CACHE }],
      },
    ];
  },
};

export default nextConfig;
