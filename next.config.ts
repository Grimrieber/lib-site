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
      "img-src 'self' data: blob: https://render.worldofwarcraft.com https://*.zamimg.com https://*.wowhead.com https://cdn.raiderio.net https://cdn.discordapp.com",
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
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Pages render a guild snapshot that refreshes hourly. We need
        // the browser to revalidate on every direct navigation so users
        // don't see stale HTML across sessions — but `no-store` would
        // also disable bf-cache, making Back/Forward navigation reload
        // from scratch. `no-cache` achieves the same revalidation
        // semantics while keeping bf-cache eligible, so Back/Forward
        // restores the page instantly. The negative-lookahead excludes
        // /_next/* and any path with a file extension so static assets
        // (JS bundles, images, fonts) keep their long cache lifetimes.
        source: "/((?!_next/|.*\\.[a-zA-Z0-9]+$).*)",
        headers: [{ key: "Cache-Control", value: "private, no-cache" }],
      },
    ];
  },
};

export default nextConfig;
