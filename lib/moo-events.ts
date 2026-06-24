import {
  getCharacterDeathStats,
  getCharacterAchievementHistory,
  type DeathStats,
} from "@/lib/battlenet";

export type AchievementRow = { id: number; name: string; completedAt: number };

/**
 * Incremental #only-moo event posts for ZamboniBoob (MeatSupreme): a post when
 * he earns a new achievement, and a "death report" when his death counters tick
 * up. Both are diff-based — store a baseline, re-poll, post the delta — so they
 * fire only on genuinely-new events.
 *
 * Deaths aren't real-time: the counters advance when Blizzard re-crawls his
 * armory after he dies (minutes to ~a day), and we get counts + category, not
 * an exact cause/time. So a death post is a tally-since-last-check, which is
 * arguably funnier — a running scoreboard of his demises.
 */
const BOOB = { realm: "eonar", name: "Meatsupreme", display: "ZamboniBoob" } as const;

export async function getBoobDeathStats(): Promise<DeathStats | null> {
  return getCharacterDeathStats(BOOB.realm, BOOB.name);
}

/**
 * His FULL achievement history (every dated achievement), fetched FRESH from
 * BNet. Deliberately NOT the snapshot-points-gated cache: that gate keyed on his
 * bundled-snapshot `achievementPoints`, which is itself crawl-frozen (observed
 * 35,290 in the snapshot vs 35,705 live), so it decided "no new achievements"
 * and served stale data forever — #only-moo stopped posting them. And we use the
 * full history (not the 10-entry recent window) so a long backlog catches up in
 * full instead of losing whatever scrolled past the cap. One character polled on
 * the snapshot cadence, so the fresh fetch is cheap.
 */
export async function getBoobAchievementHistory(): Promise<AchievementRow[]> {
  return (await getCharacterAchievementHistory(BOOB.realm, BOOB.name)) ?? [];
}

// Specific causes (from "Deaths from X") get a verb; contexts ("Total deaths in
// X") get a place. Diffing tells us which ticked up so we can say how he died.
const CAUSE: [RegExp, string][] = [
  [/deaths from falling/i, "fall damage"],
  [/deaths from drowning/i, "drowning"],
  [/deaths from fire and lava/i, "standing in fire"],
  [/deaths from fatigue/i, "fatigue — swam too far, the absolute unit"],
];
const CONTEXT: [RegExp, string][] = [
  [/total deaths in delves/i, "a delve"],
  [/total deaths in dungeons/i, "a dungeon"],
  [/total deaths in raids/i, "the raid"],
  [/total deaths in pvp battlegrounds/i, "a battleground"],
  [/total deaths in arenas/i, "the arena"],
];

function topIncrease(
  prev: DeathStats | null,
  curr: DeathStats,
  table: [RegExp, string][],
): { label: string; delta: number } | null {
  let best: { label: string; delta: number } | null = null;
  for (const [re, label] of table) {
    for (const [name, count] of Object.entries(curr.byName)) {
      if (!re.test(name)) continue;
      const delta = count - (prev?.byName[name] ?? 0);
      if (delta > 0 && (!best || delta > best.delta)) best = { label, delta };
    }
  }
  return best;
}

/**
 * The death-report post for a prev→curr diff, or null if no new deaths.
 * Returns Discord markdown (**bold**).
 */
export function describeNewDeaths(
  prev: DeathStats | null,
  curr: DeathStats,
): string | null {
  const n = (curr.total ?? 0) - (prev?.total ?? 0);
  if (n <= 0) return null;
  const total = (curr.total ?? 0).toLocaleString();
  const cause = topIncrease(prev, curr, CAUSE);
  const ctx = topIncrease(prev, curr, CONTEXT);

  // Prefer a specific cause (fall/drown/fire) for flavor; else the context.
  let how = "";
  if (cause && (!ctx || cause.delta >= ctx.delta)) how = ` to **${cause.label}**`;
  else if (ctx) how = ` in **${ctx.label}**`;

  const lead =
    n === 1
      ? `**${BOOB.display}** died${how}`
      : `**${BOOB.display}** died **${n}×** since we last checked${
          how ? `, mostly${how}` : ""
        }`;
  return `💀 ${lead}. Career deaths: **${total}**.`;
}

// Max achievements per summary embed. Discord caps an embed description at 4096
// chars; ~20 bullet lines keeps each post well under that even for long names,
// so a big catch-up (e.g. the freeze backlog) splits into multiple posts instead
// of failing to send.
const ACH_PER_POST = 20;

/**
 * Summary post(s) listing newly-earned achievements, oldest first. Returns one
 * string per ≤20-achievement page (so a long catch-up never blows Discord's
 * embed limit), or [] for none. Each page is its own embed.
 */
export function achievementSummaryPosts(names: string[]): string[] {
  if (names.length === 0) return [];
  const total = names.length;
  const pages = Math.ceil(total / ACH_PER_POST);
  const out: string[] = [];
  for (let p = 0; p < pages; p++) {
    const slice = names.slice(p * ACH_PER_POST, (p + 1) * ACH_PER_POST);
    const part = pages > 1 ? ` _(${p + 1}/${pages})_` : "";
    const header = `🏆 **${BOOB.display}** earned **${total}** new achievement${
      total === 1 ? "" : "s"
    } since last check${part}:`;
    out.push(`${header}\n${slice.map((n) => `• ${n}`).join("\n")}`);
  }
  return out;
}

// --- Baseline store: what we've already posted, so we only post NEW events. ---
// One Upstash key. First run SEEDS it (posts nothing); later runs post the
// delta. Deaths diff on the counters; achievements diff on seen ids.
import { getRedis } from "@/lib/announce-store";

export type MooEventBaseline = {
  deathTotal: number | null;
  deathByName: Record<string, number>;
  seenAchievementIds: number[];
  /** Completion timestamp (ms) of the newest achievement we've posted. The diff
   *  surfaces everything newer than this (NOT just the 10-entry recent window),
   *  so a long backlog catches up in full. Absent on baselines written before
   *  this field existed — derived from the seen set on the first run after. */
  lastAchievementTs?: number;
};
const EVENT_BASELINE_KEY = "lib:moo:events:v1";

export async function loadEventBaseline(): Promise<MooEventBaseline | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const v = await redis.get<MooEventBaseline>(EVENT_BASELINE_KEY);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export async function saveEventBaseline(b: MooEventBaseline): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(EVENT_BASELINE_KEY, b);
  } catch {
    /* best-effort */
  }
}

// Degenerate fallback only: if a baseline has no seen ids that match the live
// history (should never happen in practice), look back at most this far so we
// never dump his entire career as "new".
const CATCHUP_LOOKBACK_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * The cutoff timestamp for "new since we last posted". Prefers the stored
 * `lastAchievementTs`. On the first run after upgrading (none stored) it's
 * derived from the newest already-seen achievement — i.e. the last one we
 * posted — so that first poll catches up the entire backlog since the freeze.
 */
export function achievementCutoff(
  baseline: MooEventBaseline,
  history: AchievementRow[],
  nowMs: number,
): number {
  if (baseline.lastAchievementTs != null) return baseline.lastAchievementTs;
  const seen = new Set(baseline.seenAchievementIds);
  const seenTs = history
    .filter((a) => seen.has(a.id))
    .map((a) => a.completedAt);
  if (seenTs.length) return Math.max(...seenTs);
  return nowMs - CATCHUP_LOOKBACK_MS;
}

/**
 * Every achievement earned at/after the cutoff that we haven't posted yet,
 * oldest first. Uses the FULL history (not the 10-entry recent cap), so however
 * many he earned — 3 or 50 — they all surface.
 */
export function missedAchievements(
  history: AchievementRow[],
  seenIds: number[],
  cutoffMs: number,
): AchievementRow[] {
  const seen = new Set(seenIds);
  return history
    .filter((a) => !seen.has(a.id) && a.completedAt >= cutoffMs)
    .sort((a, b) => a.completedAt - b.completedAt);
}

/** Reconstruct a DeathStats from a stored baseline so describeNewDeaths can diff. */
export function baselineToDeathStats(b: MooEventBaseline): DeathStats {
  return {
    total: b.deathTotal,
    byName: b.deathByName ?? {},
    updatedByName: {},
    updatedAt: null,
  };
}

// Short display labels for the death tally on the kickoff post.
const DEATH_DISPLAY: [RegExp, string][] = [
  [/deaths from falling/i, "Falls"],
  [/deaths from drowning/i, "Drownings"],
  [/deaths from fire and lava/i, "Fire/lava"],
  [/deaths from fatigue/i, "Fatigue"],
  [/total deaths in dungeons/i, "Dungeons"],
  [/total deaths in delves/i, "Delves"],
  [/total deaths in raids/i, "Raids"],
  [/total deaths in pvp battlegrounds/i, "PvP"],
  [/total deaths in arenas/i, "Arenas"],
];

// Drop counters Blizzard hasn't updated in this long — they're abandoned and
// misleading (e.g. "Total deaths in raids" froze at 3 on 2025-08-01; a 3/9 M
// raider obviously has far more, but his real raid deaths fell into the
// uncategorized bulk that only "Total deaths" captures).
const STALE_COUNTER_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * Ordered, labeled death breakdown for display (skips the headline total, and
 * skips abandoned/stale counters so we don't post numbers like "Raids 3").
 */
export function deathBreakdown(
  stats: DeathStats,
  now: number = Date.now(),
): { label: string; count: number }[] {
  const out: { label: string; count: number }[] = [];
  for (const [re, label] of DEATH_DISPLAY) {
    const entry = Object.entries(stats.byName).find(
      ([n]) => re.test(n) && !/^total deaths$/i.test(n),
    );
    if (!entry) continue;
    const upd = stats.updatedByName?.[entry[0]];
    if (upd && now - upd > STALE_COUNTER_MS) continue; // abandoned counter
    out.push({ label, count: entry[1] });
  }
  return out;
}

// The resurrection-method counters ("how he gets back up") — also in the
// Deaths category. `label` is the short tally label; `verb` is the past-tense
// phrase for the resurrection report. Comedy gold for the channel.
const REZ: { re: RegExp; label: string; verb: string }[] = [
  { re: /rebirthed by druids/i, label: "Battle-rez (druid)", verb: "battle-rezzed by a druid" },
  { re: /raised by death knights/i, label: "Raised by DKs", verb: "dragged out of the dirt by a death knight" },
  { re: /restored by paladins/i, label: "Restored (pala)", verb: "restored by a paladin" },
  { re: /redeemed by paladins/i, label: "Redeemed (pala)", verb: "redeemed by a paladin" },
  { re: /resurrected by priests/i, label: "Rez (priest)", verb: "rezzed by a priest" },
  { re: /revived by druids/i, label: "Revived (druid)", verb: "revived by a druid" },
  { re: /spirit returned to body by shamans/i, label: "Ankh (shaman)", verb: "ankh'd back by a shaman" },
  { re: /resuscitated by monks/i, label: "Resus (monk)", verb: "resuscitated by a monk" },
  { re: /returned by evokers/i, label: "Returned (evoker)", verb: "returned by an evoker" },
  { re: /resurrected by soulstones/i, label: "Soulstone", verb: "soulstoned back from the brink" },
];

/**
 * Resurrection-method breakdown — EVERY class that's brought him back, highest
 * first. No freshness filter (unlike deaths): these counts are accurate
 * cumulative totals, and the full "brought back by every class" list is the joke.
 */
export function resurrectionBreakdown(
  stats: DeathStats,
): { label: string; count: number }[] {
  const out: { label: string; count: number }[] = [];
  for (const { re, label } of REZ) {
    const entry = Object.entries(stats.byName).find(([n]) => re.test(n));
    if (entry) out.push({ label, count: entry[1] });
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * The resurrection-report post for a prev→curr diff — the counterpart to the
 * death report, fires when a rez-method counter ticks up. Returns Discord
 * markdown, or null if nothing new.
 */
export function describeNewResurrections(
  prev: DeathStats | null,
  curr: DeathStats,
): string | null {
  const deltas: { verb: string; delta: number }[] = [];
  for (const { re, verb } of REZ) {
    const entry = Object.entries(curr.byName).find(([n]) => re.test(n));
    if (!entry) continue;
    const delta = entry[1] - (prev?.byName[entry[0]] ?? 0);
    if (delta > 0) deltas.push({ verb, delta });
  }
  const n = deltas.reduce((s, d) => s + d.delta, 0);
  if (n <= 0) return null;
  if (n === 1) {
    return `✨ **${BOOB.display}** got dragged back to life — **${deltas[0].verb}**.`;
  }
  deltas.sort((a, b) => b.delta - a.delta);
  const detail = deltas.map((d) => `${d.delta}× ${d.verb}`).join(", ");
  return `✨ **${BOOB.display}** was hauled back **${n}×** since last check: ${detail}.`;
}

/**
 * The one-time kickoff post sent when tracking starts (the seed run): his last
 * 5 achievements + career death tally. After this, deaths/achievements post
 * incrementally. Returns Discord markdown (title + description).
 */
export function buildKickoffPost(
  stats: DeathStats | null,
  achievements: { name: string }[],
): { title: string; description: string } {
  const achList =
    achievements
      .slice(0, 10)
      .map((a) => `• ${a.name}`)
      .join("\n") || "• (none found)";
  let deaths = "";
  let rez = "";
  if (stats) {
    const totalN = stats.total ?? 0;
    const shown = deathBreakdown(stats);
    const parts = shown.map((d) => `${d.label} ${d.count}`);
    // The tracked categories only cover the categorized deaths; the rest
    // (open world, etc.) are uncategorized. Add an "Other" line so the
    // breakdown reconciles to the headline Total.
    const other = totalN - shown.reduce((s, d) => s + d.count, 0);
    if (other > 0) parts.push(`Other ${other.toLocaleString()}`);
    deaths = `\n\n**Career death tally: ${totalN.toLocaleString()}**\n${parts.join(
      " · ",
    )}`;
    const rb = resurrectionBreakdown(stats)
      .map((r) => `${r.label} ${r.count}`)
      .join(" · ");
    if (rb) rez = `\n\n**Brought back**\n${rb}`;
  }
  return {
    title: `🐄 Now watching ${BOOB.display}`,
    description:
      `**Recent achievements**\n${achList}${deaths}${rez}\n\n` +
      `From here on, new achievements post as a summary and every death posts automatically.`,
  };
}
