// Twitter share image — delegates to the OG image so both platforms use the
// same dynamic card. Next.js requires a separate file to wire the
// `twitter:image` meta tag; importing the OG export keeps the rendering
// logic in one place.
//
// Next.js parses route-segment configs (`revalidate`, etc.) at build time
// and refuses to follow re-exports — so we re-declare `revalidate` as a
// fresh literal here. The other exports (default, alt, size, contentType)
// can be re-exported normally.
export const revalidate = 1800;
export { default, alt, size, contentType } from "./opengraph-image";
