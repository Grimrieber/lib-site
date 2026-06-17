import { getCharacterDeathStats, type DeathStats } from "@/lib/battlenet";
import { getCharacterAchievementsCached } from "@/lib/raiderio";

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

export async function getBoobRecentAchievements(): Promise<
  { id: number; name: string; timestamp: number }[]
> {
  // Cached variant: gates the 2.67MB blob parse on his achievement_points (from
  // the bundled snapshot), so an idle poll is a cheap Upstash read. When he
  // earns something his points change and it re-fetches fresh recent_events.
  const a = await getCharacterAchievementsCached(BOOB.realm, BOOB.name);
  return a?.recent ?? [];
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

/**
 * ONE summary post listing every achievement earned since the last capture
 * (replaces per-achievement posts). Returns null if there are none.
 */
export function describeAchievementSummary(names: string[]): string | null {
  if (names.length === 0) return null;
  const header = `🏆 **${BOOB.display}** earned **${names.length}** new achievement${
    names.length === 1 ? "" : "s"
  } since last check:`;
  return `${header}\n${names.map((n) => `• ${n}`).join("\n")}`;
}

// --- Baseline store: what we've already posted, so we only post NEW events. ---
// One Upstash key. First run SEEDS it (posts nothing); later runs post the
// delta. Deaths diff on the counters; achievements diff on seen ids.
import { getRedis } from "@/lib/announce-store";

export type MooEventBaseline = {
  deathTotal: number | null;
  deathByName: Record<string, number>;
  seenAchievementIds: number[];
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

/** Recent achievements whose ids we haven't posted yet. */
export function newAchievements(
  seenIds: number[],
  recent: { id: number; name: string; timestamp: number }[],
): { id: number; name: string }[] {
  const seen = new Set(seenIds);
  return recent
    .filter((r) => !seen.has(r.id))
    .map((r) => ({ id: r.id, name: r.name }));
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
  if (stats) {
    const total = (stats.total ?? 0).toLocaleString();
    const bd = deathBreakdown(stats)
      .map((d) => `${d.label} ${d.count}`)
      .join(" · ");
    deaths = `\n\n**Career death tally: ${total}**\n${bd}`;
  }
  return {
    title: `🐄 Now watching ${BOOB.display}`,
    description:
      `**Recent achievements**\n${achList}${deaths}\n\n` +
      `From here on, new achievements post as a summary and every death posts automatically.`,
  };
}
