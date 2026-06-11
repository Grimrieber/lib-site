// Twitter share image — delegates to the OG image so both platforms use the
// same dynamic card. Next.js requires a separate file to wire the
// `twitter:image` meta tag; importing the OG export keeps the rendering
// logic in one place.
//
// Next.js parses route-segment configs at build time and refuses to follow
// re-exports — so we re-declare `revalidate` as a fresh literal here to
// match the OG image's hourly CDN caching. The other exports (default, alt,
// size, contentType) can be re-exported.
export const revalidate = 3600;
export { default, alt, size, contentType } from "./opengraph-image";
