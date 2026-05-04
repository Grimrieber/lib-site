// Twitter share image — delegates to the OG image so both platforms use the
// same dynamic card. Next.js requires a separate file to wire the
// `twitter:image` meta tag; importing the OG export keeps the rendering
// logic in one place.
//
// Next.js parses route-segment configs at build time and refuses to follow
// re-exports — so we re-declare `dynamic` as a fresh literal here. The
// other exports (default, alt, size, contentType) can be re-exported.
export const dynamic = "force-dynamic";
export { default, alt, size, contentType } from "./opengraph-image";
