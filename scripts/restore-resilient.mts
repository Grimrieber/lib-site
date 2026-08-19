/**
 * Restore Resilient records that a season rollover deleted.
 *
 *   npx tsx scripts/restore-resilient.mts [--ref <git-ref>] [--write]
 *
 * WHY THIS IS NEEDED
 *
 * Resilient is a permanent milestone, but the pre-fix snapshot builder dropped
 * any character it could not recompute. At the MN S1->S2 flip the run history
 * reset, so every character read as "active", nothing recomputed against an
 * empty new-season dungeon pool, and the board went from 32 entries (top keys
 * 21, 20, 20) to 1 in a single build.
 *
 * lib/resilient.ts stops that happening again, but it CANNOT bring the lost
 * records back: they were earned on last season's runs, and those runs are not
 * in the new season's history. The only surviving copy is in git, in the last
 * snapshot committed before the flip. This script recovers them from there.
 *
 * It reuses reconcileResilient, so the restore obeys exactly the same rule the
 * runtime does - scoped to the current roster, highest tier wins, ties keep the
 * original earnedAt. That also makes it idempotent: running it twice changes
 * nothing the second time.
 *
 * Dry-run by default. Pass --write to modify data/snapshot.json.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { reconcileResilient, resilientKey } from "../lib/resilient.js";
import type { Character, ResilientAchievement } from "../lib/types.js";

const SNAPSHOT = "data/snapshot.json";
const argv = process.argv.slice(2);
const write = argv.includes("--write");
const refArg = argv.indexOf("--ref");
const explicitRef = refArg >= 0 ? argv[refArg + 1] : undefined;

type SnapshotFile = {
  snapshot: {
    roster?: Character[];
    resilient?: ResilientAchievement[];
    currentSeasonSlug?: string;
  };
};

function readAtRef(ref: string): SnapshotFile | null {
  try {
    const raw = execFileSync("git", ["show", `${ref}:${SNAPSHOT}`], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    return JSON.parse(raw) as SnapshotFile;
  } catch {
    return null;
  }
}

/**
 * Find the commit holding the richest Resilient board.
 *
 * Deliberately "most entries" rather than "before date X": the point is to
 * recover everything ever recorded, and it makes the script reusable for any
 * future loss without someone having to know when it happened.
 */
function findBestRef(): { ref: string; entries: ResilientAchievement[] } | null {
  const refs = execFileSync(
    "git",
    ["log", "--format=%H", "-60", "--", SNAPSHOT],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);

  let best: { ref: string; entries: ResilientAchievement[] } | null = null;
  for (const ref of refs) {
    const file = readAtRef(ref);
    const entries = file?.snapshot.resilient ?? [];
    if (!best || entries.length > best.entries.length) best = { ref, entries };
  }
  return best;
}

const current = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as SnapshotFile;
const roster = current.snapshot.roster ?? [];
const currentEntries = current.snapshot.resilient ?? [];

const source = explicitRef
  ? { ref: explicitRef, entries: readAtRef(explicitRef)?.snapshot.resilient ?? [] }
  : findBestRef();

if (!source || source.entries.length === 0) {
  console.error("No historical Resilient records found. Nothing to restore.");
  process.exit(1);
}

// Standing records = whatever history holds, keyed for reconciliation. The
// CURRENT entries are folded in as "fresh" so anything earned since the loss
// still wins if it is higher.
const priorByKey = new Map(
  source.entries.map((e) => [
    resilientKey(e.runner.realmSlug, e.runner.name),
    e,
  ]),
);
const rosterKeys = roster.map((c) => resilientKey(c.realmSlug, c.name));
const merged = reconcileResilient(rosterKeys, priorByKey, currentEntries);

const top = [...merged].sort((a, b) => b.level - a.level).slice(0, 5);
console.log(`source commit    : ${source.ref.slice(0, 7)} (${source.entries.length} entries)`);
console.log(`snapshot now     : ${currentEntries.length} entries`);
console.log(`after restore    : ${merged.length} entries`);
console.log(
  `off-roster dropped: ${source.entries.length - merged.length < 0 ? 0 : source.entries.length - merged.length}`,
);
console.log("top after restore:");
for (const e of top) {
  console.log(`  ${e.runner.name} - Resilient ${e.level} (${e.earnedAt.slice(0, 10)})`);
}

if (merged.length === currentEntries.length) {
  console.log("\nNothing to do - the board is already complete.");
  process.exit(0);
}

if (!write) {
  console.log("\nDry run. Re-run with --write to apply.");
  process.exit(0);
}

current.snapshot.resilient = merged;
// Match the refresh pipeline's pretty-printed output (PowerShell
// ConvertTo-Json, 2-space indent) so this edit produces a readable diff
// instead of collapsing the file to one line.
writeFileSync(SNAPSHOT, `${JSON.stringify(current, null, 2)}
`, "utf8");
console.log(`\nWrote ${merged.length} entries to ${SNAPSHOT}.`);
