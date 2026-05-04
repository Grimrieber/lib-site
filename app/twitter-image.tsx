// Twitter share image — delegates to the OG image so both platforms use the
// same dynamic card. Next.js requires a separate file to wire the
// `twitter:image` meta tag; importing the OG export keeps the rendering
// logic in one place.
export {
  default,
  alt,
  size,
  contentType,
  revalidate,
} from "./opengraph-image";
