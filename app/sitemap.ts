import type { MetadataRoute } from "next";

/**
 * Lists the public, indexable routes for crawlers. Character and per-raid
 * pages are intentionally omitted — they're driven by live RIO data and
 * change frequently; we don't want them in the sitemap as cached entries.
 *
 * The base URL is read from `NEXT_PUBLIC_SITE_URL` if set (e.g. on Vercel),
 * with a localhost fallback so dev builds don't break.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "http://localhost:3000";
  const now = new Date();
  const routes = ["", "/roster", "/progression", "/recruit", "/about"];
  return routes.map((path) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: path === "" ? "hourly" : "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
}
