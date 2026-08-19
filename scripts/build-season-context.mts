/**
 * Writes the resolved season/expansion context into data/snapshot.json.
 *
 * The context is normally produced by the hourly snapshot build, but module-level
 * consumers (SEASON_SLUGS, the expansion scan range) read it from the DEPLOYED
 * bundle. Without this, the window between deploying the context change and the
 * first snapshot build afterwards would run on the degraded fallback — one score
 * column per character instead of the full season history.
 *
 * Safe to run any time: it only touches RIO's public static-data endpoints and
 * the local JSON file. No Upstash, no BNet, no roster enrichment.
 *
 *   npx tsx scripts/build-season-context.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildSeasonContext } from "../lib/season-context.js";

const PATH = "data/snapshot.json";
const file = JSON.parse(readFileSync(PATH, "utf8"));
const snap = file.snapshot;
const current: string | null = snap.currentSeasonSlug ?? null;

const ctx = await buildSeasonContext(current);
if (!ctx) {
  console.error("Could not resolve a season context — leaving snapshot alone.");
  process.exit(1);
}
snap.seasonContext = ctx;
// Match the refresh pipeline's pretty-printed output (PowerShell
// ConvertTo-Json, 2-space indent) so this edit produces a readable diff
// instead of collapsing the file to one line.
writeFileSync(PATH, `${JSON.stringify(file, null, 2)}
`, "utf8");
console.log("current season   :", ctx.currentSeasonSlug);
console.log("season starts    :", ctx.currentSeasonStartsAt && new Date(ctx.currentSeasonStartsAt).toISOString());
console.log("expansion        :", ctx.currentExpansionId);
console.log("expansion ids    :", ctx.expansionIds.join(","));
console.log("main seasons     :", ctx.mainSeasonSlugs.length, "->", ctx.mainSeasonSlugs.slice(0, 5).join(", "), "...");
console.log("all seasons known:", ctx.allSeasons.length);
