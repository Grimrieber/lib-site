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
      // Wowhead/zamimg power tooltip widget + Next.js dev needs unsafe-eval/inline.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://wow.zamimg.com",
      "style-src 'self' 'unsafe-inline'",
      // All allowed remote image origins.
      "img-src 'self' data: blob: https://render.worldofwarcraft.com https://wow.zamimg.com https://cdn.raiderio.net",
      "font-src 'self' data:",
      // Wowhead tooltips fetch from these origins on hover.
      "connect-src 'self' https://www.wowhead.com https://wow.zamimg.com",
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
    ];
  },
};

export default nextConfig;
