/**
 * OFFLINE FALLBACK list of hand-verified cow photos. The live picker
 * (getRandomCowUrl in lib/moo.ts) normally pulls a fresh random cow from the
 * Commons breed categories below — effectively unlimited, no manual curation.
 * This short list is only used if Commons is unreachable at post time.
 *
 * All from Wikimedia Commons (freely licensed); Discord fetches them directly
 * so the site CSP (which doesn't whitelist upload.wikimedia.org) doesn't matter
 * for the real post — only the on-site preview inlines them as data URIs.
 */
export const MOO_COWS: readonly string[] = [
  // Highland — lying under a pine, classic ginger coo
  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/A_lovely_%22Scottisch_cow%22_at_Oud_Reemst_Januari_2012_-_panoramio.jpg/960px-A_lovely_%22Scottisch_cow%22_at_Oud_Reemst_Januari_2012_-_panoramio.jpg",
  // Highland — full-body portrait, Scone Palace
  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/2016_-_Scone_Palace_%2830427974732%29.jpg/960px-2016_-_Scone_Palace_%2830427974732%29.jpg",
  // Jersey — being petted at a fence (wholesome)
  "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Bill_pets_a_Jersey.jpg/960px-Bill_pets_a_Jersey.jpg",
  // Highland — cream/blonde, full body
  "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Cow-PICT1270.JPG/960px-Cow-PICT1270.JPG",
  // Highland — brown, in woodland
  "https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/Biffdjur%2C_Kainulasj%C3%A4rvi%2C_Pajala.jpg/960px-Biffdjur%2C_Kainulasj%C3%A4rvi%2C_Pajala.jpg",
  // Highland — close-up horned face
  "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Carolien.JPG/960px-Carolien.JPG",
  // Highland — red, full body in pasture
  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Diablotin_of_Antonennia.JPG/960px-Diablotin_of_Antonennia.JPG",
  // Highland — shaggy, grazing
  "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Cow_%285380180525%29.jpg/960px-Cow_%285380180525%29.jpg",
];

/**
 * Wikimedia Commons BREED categories the live picker draws from — each holds
 * hundreds of real, wholesome cow photos, so the channel has effectively
 * unlimited variety with zero manual curation. We use breed categories (not
 * the random "cow" tag) precisely because they're reliably actual cattle.
 * Highland is repeated to weight it (the safest + most photogenic pool).
 * getRandomCowUrl() (lib/moo.ts) picks a random category, then a random file.
 */
export const MOO_COW_CATEGORIES: readonly string[] = [
  "Category:Highland cattle",
  "Category:Highland cattle",
  "Category:Highland cattle",
  "Category:Belted Galloway cattle",
  "Category:Jersey cattle",
  "Category:Hereford cattle",
  "Category:Brown Swiss cattle",
  "Category:Guernsey cattle",
  "Category:Holstein Friesian cattle",
  "Category:Aberdeen Angus cattle",
];

/**
 * ZamboniBoob's ACTUAL character — MeatSupreme, a Tauren Paladin in head-to-toe
 * yellow ("the yellow pajamas"). The full-body, transparent-background render
 * from Battle.net character-media. Lives on render.worldofwarcraft.com, which
 * IS in the site CSP's img-src, so it renders in-browser with no data-URI hack.
 *
 * The daily job posts this occasionally instead of a cow (paired with a
 * 'render'-tagged caption in data/moo-captions.json) — "the man himself."
 *
 * The numeric render id changes if his transmog/appearance is re-rendered; to
 * always stay current, refetch the `main-raw` asset from
 *   /profile/wow/character/eonar/meatsupreme/character-media
 * instead of hardcoding. Hardcoded here for now (transmog rarely changes).
 */
export const MOO_BOOB_RENDER =
  "https://render.worldofwarcraft.com/us/character/eonar/67/236746307-main-raw.png";
