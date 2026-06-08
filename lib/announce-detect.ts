/**
 * Discord announcement — detection / diff layer.
 *
 * Pure functions. `detect()` compares the current guild snapshot against the
 * persisted baseline and returns the new events to announce plus the updated
 * baseline. `baselineFromSnapshot()` + `seedEvents()` drive the one-time cold
 * start (mark everything currently true as "known", and post a best-of-each
 * seed so the channel opens alive instead of empty).
 *
 * Debouncing is the whole point here — the snapshot has known noise (RIO
 * score recalcs, mojibake names, the live-vs-snapshot gap). The rules:
 *   - PB fires only on a score increase >= PB_MIN_DELTA (filters recalc jitter),
 *     and only for characters we've already seen (a brand-new roster member
 *     isn't a "personal best").
 *   - Guild record fires only when the HOLDER changes — the #1 climbing their
 *     own record is their PB, not a fresh "crown", so we don't double-announce.
 *   - Resilient reuses the exact override + cohort-key logic the on-site popup
 *     uses; only earners within the recency window are announced.
 *   - Per-run caps keep a burst (or a misbehaving baseline) from flooding.
 */

import type { Character, Difficulty, GuildSnapshot } from "@/lib/types";
import { RESILIENT_OVERRIDES } from "@/lib/resilient-overrides";
import type { AnnounceEvent } from "@/lib/discord-announce";

export type AnnounceBaseline = {
  version: 1;
  /** Whether the one-time seed has run. Detection assumes a seeded baseline. */
  seeded: boolean;
  /** Announcements posted since the last site-reminder (fires on the 10th). */
  counter: number;
  /** Current guild M+ record. */
  record: { score: number; player: string } | null;
  /** charKey ("name@realmSlug") -> last-seen mythicPlusScore. */
  scores: Record<string, number>;
  /** Killed boss slugs already known, per announced difficulty. */
  kills: { Mythic: string[]; Heroic: string[] };
  /** Resilient cohort keys ("name@level@earnedAt") already known. */
  resilient: string[];
  updatedAt: string;
};

export const ANNOUNCE_VERSION = 1 as const;

// --- tunables ---------------------------------------------------------------
/** Minimum M+ score increase to count as a personal best (filters recalcs). */
const PB_MIN_DELTA = 25;
/** Cap PBs announced in a single run; extras still update the baseline. */
const PB_MAX_PER_RUN = 8;
/** Cap Resilient announcements in a single run. */
const RESILIENT_MAX_PER_RUN = 8;
/** Float guard so a sub-point recalc doesn't read as a new record. */
const RECORD_EPSILON = 0.05;
/** Only announce Resilient tiers earned within this window (days). Mirrors
 *  the on-site popup so a late run doesn't surface ancient earners. */
const RESILIENT_WINDOW_DAYS = 7;

const ANNOUNCED_DIFFICULTIES: ("Mythic" | "Heroic")[] = ["Mythic", "Heroic"];
const DIFF_ABBREV: Record<Difficulty, string> = {
  Mythic: "M",
  Heroic: "H",
  Normal: "N",
};

export const EMPTY_BASELINE: AnnounceBaseline = {
  version: ANNOUNCE_VERSION,
  seeded: false,
  counter: 0,
  record: null,
  scores: {},
  kills: { Mythic: [], Heroic: [] },
  resilient: [],
  updatedAt: "1970-01-01T00:00:00.000Z",
};

// --- helpers ----------------------------------------------------------------

const charKey = (c: { name: string; realmSlug: string }) =>
  `${c.name}@${c.realmSlug}`;

const resilientKey = (a: { runner: { name: string }; level: number; earnedAt: string }) =>
  `${a.runner.name}@${a.level}@${a.earnedAt}`;

/** Mirror app/page.tsx applyOverrides: drop hidden chars, force earnedAt. */
function applyResilientOverrides(
  achievements: GuildSnapshot["resilient"],
): NonNullable<GuildSnapshot["resilient"]> {
  const out: NonNullable<GuildSnapshot["resilient"]> = [];
  for (const a of achievements ?? []) {
    const o = RESILIENT_OVERRIDES[a.runner.name];
    if (!o) {
      out.push(a);
      continue;
    }
    if (o.hide) continue;
    out.push(o.earnedAt ? { ...a, earnedAt: o.earnedAt } : a);
  }
  return out;
}

function rosterByName(snapshot: GuildSnapshot): Map<string, Character> {
  const m = new Map<string, Character>();
  for (const c of snapshot.roster) m.set(c.name, c);
  return m;
}

function avatarFor(
  byName: Map<string, Character>,
  name: string,
): string | undefined {
  return byName.get(name)?.avatarUrl;
}

function tierFor(
  snapshot: GuildSnapshot,
  difficulty: Difficulty,
): GuildSnapshot["tiers"][number] | undefined {
  return snapshot.tiers.find((t) => t.difficulty === difficulty);
}

/** Footer context line — expansion name when available (e.g. "Midnight"). */
function contextFor(snapshot: GuildSnapshot): string | undefined {
  return snapshot.tierExpansionName || undefined;
}

/** Top-scoring roster character (by mythicPlusScore), or null. */
function topScorer(snapshot: GuildSnapshot): Character | null {
  let best: Character | null = null;
  for (const c of snapshot.roster) {
    if (typeof c.mythicPlusScore !== "number") continue;
    if (!best || c.mythicPlusScore > (best.mythicPlusScore ?? 0)) best = c;
  }
  return best;
}

// --- ongoing detection ------------------------------------------------------

export type DetectResult = {
  events: AnnounceEvent[];
  nextBaseline: AnnounceBaseline;
  /** Non-fatal notes (e.g. caps hit) for the route to log. */
  notes: string[];
};

export function detect(
  snapshot: GuildSnapshot,
  baseline: AnnounceBaseline,
  nowMs: number = Date.now(),
): DetectResult {
  const events: AnnounceEvent[] = [];
  const notes: string[] = [];
  const byName = rosterByName(snapshot);
  const context = contextFor(snapshot);

  // Carry counter/seeded through; data fields get rebuilt below.
  const next: AnnounceBaseline = {
    version: ANNOUNCE_VERSION,
    seeded: baseline.seeded,
    counter: baseline.counter,
    record: baseline.record,
    scores: {},
    kills: { Mythic: [], Heroic: [] },
    resilient: [],
    updatedAt: new Date(nowMs).toISOString(),
  };

  // 1. Boss kills (Mythic, then Heroic) -------------------------------------
  for (const diff of ANNOUNCED_DIFFICULTIES) {
    const tier = tierFor(snapshot, diff);
    const current = tier?.killedSlugs ?? [];
    const known = new Set(baseline.kills[diff] ?? []);
    next.kills[diff] = [...current];
    if (!tier) continue;
    for (const slug of current) {
      if (known.has(slug)) continue;
      const boss = tier.bosses.find((b) => b.slug === slug);
      events.push({
        kind: "kill",
        difficulty: diff,
        boss: boss?.name ?? slug,
        progress: `${tier.killed} / ${tier.totalBosses} ${DIFF_ABBREV[diff]}`,
        bossIcon: boss?.iconUrl,
        firstKill: true,
        context,
      });
    }
  }

  // 2. Guild M+ record — only when a NEW holder takes the crown -------------
  let recordHolderName: string | null = null;
  const top = topScorer(snapshot);
  if (top && typeof top.mythicPlusScore === "number") {
    const curScore = top.mythicPlusScore;
    if (!baseline.record) {
      // No prior record (shouldn't happen post-seed) — initialize silently.
      next.record = { score: curScore, player: top.name };
    } else if (
      curScore > baseline.record.score + RECORD_EPSILON &&
      top.name !== baseline.record.player
    ) {
      recordHolderName = top.name;
      events.push({
        kind: "record",
        player: top.name,
        score: curScore,
        prevScore: baseline.record.score,
        prevHolder: baseline.record.player,
        avatar: top.avatarUrl,
        context,
      });
      next.record = { score: curScore, player: top.name };
    } else {
      // Same holder (possibly climbing) or no increase — advance the stored
      // high-water mark so the next overtake diffs correctly, no event.
      next.record = {
        score: Math.max(curScore, baseline.record.score),
        player: curScore >= baseline.record.score ? top.name : baseline.record.player,
      };
    }
  } else {
    next.record = baseline.record;
  }

  // 3. Personal bests — score climbed past threshold ------------------------
  type Pb = { char: Character; delta: number };
  const pbCandidates: Pb[] = [];
  for (const c of snapshot.roster) {
    if (typeof c.mythicPlusScore !== "number") continue;
    const key = charKey(c);
    next.scores[key] = c.mythicPlusScore;
    const prev = baseline.scores[key];
    if (prev === undefined) continue; // new character — seed silently
    const delta = c.mythicPlusScore - prev;
    if (delta < PB_MIN_DELTA) continue;
    // The new record-taker already gets a crown — don't also fire their PB.
    if (recordHolderName && c.name === recordHolderName) continue;
    pbCandidates.push({ char: c, delta });
  }
  pbCandidates.sort((a, b) => b.delta - a.delta);
  if (pbCandidates.length > PB_MAX_PER_RUN)
    notes.push(
      `PB cap: ${pbCandidates.length} candidates, announced ${PB_MAX_PER_RUN}`,
    );
  for (const { char: c, delta } of pbCandidates.slice(0, PB_MAX_PER_RUN)) {
    events.push({
      kind: "pb",
      player: c.name,
      score: c.mythicPlusScore as number,
      delta,
      avatar: c.avatarUrl,
      context,
    });
  }

  // 4. Resilient — new cohort keys within the recency window ----------------
  const applied = applyResilientOverrides(snapshot.resilient);
  next.resilient = applied.map(resilientKey);
  const known = new Set(baseline.resilient);
  const cutoff = nowMs - RESILIENT_WINDOW_DAYS * 24 * 3600 * 1000;
  const resCandidates = applied
    .filter((a) => !known.has(resilientKey(a)))
    .filter((a) => new Date(a.earnedAt).getTime() >= cutoff)
    .sort((a, b) => (b.level !== a.level ? b.level - a.level : b.score - a.score));
  if (resCandidates.length > RESILIENT_MAX_PER_RUN)
    notes.push(
      `Resilient cap: ${resCandidates.length} new, announced ${RESILIENT_MAX_PER_RUN}`,
    );
  for (const a of resCandidates.slice(0, RESILIENT_MAX_PER_RUN)) {
    events.push({
      kind: "resilient",
      player: a.runner.name,
      level: a.level,
      score: a.score,
      avatar: avatarFor(byName, a.runner.name),
      context,
    });
  }

  return { events, nextBaseline: next, notes };
}

// --- cold start -------------------------------------------------------------

/** Build a baseline that marks everything currently true as "known", so the
 *  first post-seed detect() run announces nothing pre-existing. */
export function baselineFromSnapshot(
  snapshot: GuildSnapshot,
  nowMs: number = Date.now(),
): AnnounceBaseline {
  const scores: Record<string, number> = {};
  for (const c of snapshot.roster) {
    if (typeof c.mythicPlusScore === "number") scores[charKey(c)] = c.mythicPlusScore;
  }
  const top = topScorer(snapshot);
  const applied = applyResilientOverrides(snapshot.resilient);
  return {
    version: ANNOUNCE_VERSION,
    seeded: true,
    counter: 0,
    record:
      top && typeof top.mythicPlusScore === "number"
        ? { score: top.mythicPlusScore, player: top.name }
        : null,
    scores,
    kills: {
      Mythic: [...(tierFor(snapshot, "Mythic")?.killedSlugs ?? [])],
      Heroic: [...(tierFor(snapshot, "Heroic")?.killedSlugs ?? [])],
    },
    resilient: applied.map(resilientKey),
    updatedAt: new Date(nowMs).toISOString(),
  };
}

/** Best-of-each seed (~4 content messages; the route appends the reminder).
 *  Frames current standings — not deltas — so a cold channel opens alive. */
export function seedEvents(snapshot: GuildSnapshot): AnnounceEvent[] {
  const events: AnnounceEvent[] = [];
  const byName = rosterByName(snapshot);
  const context = contextFor(snapshot);

  // Latest kill: hardest difficulty with any kills, its most-advanced boss.
  for (const diff of ANNOUNCED_DIFFICULTIES) {
    const tier = tierFor(snapshot, diff);
    const slugs = tier?.killedSlugs ?? [];
    if (!tier || slugs.length === 0) continue;
    const slug = slugs[slugs.length - 1];
    const boss = tier.bosses.find((b) => b.slug === slug);
    events.push({
      kind: "kill",
      difficulty: diff,
      boss: boss?.name ?? slug,
      progress: `${tier.killed} / ${tier.totalBosses} ${DIFF_ABBREV[diff]}`,
      bossIcon: boss?.iconUrl,
      firstKill: false,
      context,
    });
    break; // only the hardest difficulty's headline
  }

  // Current guild M+ record.
  const top = topScorer(snapshot);
  if (top && typeof top.mythicPlusScore === "number") {
    events.push({
      kind: "record",
      player: top.name,
      score: top.mythicPlusScore,
      avatar: top.avatarUrl,
      context,
    });
  }

  // Top key this week, framed as a push highlight (no delta — it's a current
  // standing, not a jump). Prefer a runner other than the record holder so the
  // seed doesn't headline the same person three times when one player tops
  // every category; fall back to the outright top run if that's all there is.
  const runs = snapshot.weeklyTopRuns ?? [];
  const pickRun =
    runs.find((r) => {
      const n = r.runners?.[0]?.name;
      return n && n !== top?.name;
    }) ?? runs[0];
  const runnerName = pickRun?.runners?.[0]?.name;
  if (pickRun && runnerName) {
    const char = byName.get(runnerName);
    events.push({
      kind: "pb",
      player: runnerName,
      score: char?.mythicPlusScore ?? pickRun.score,
      dungeon: pickRun.dungeon,
      level: pickRun.level,
      avatar: char?.avatarUrl,
      context,
    });
  }

  // Current top Resilient earner.
  const applied = applyResilientOverrides(snapshot.resilient).sort((a, b) =>
    b.level !== a.level ? b.level - a.level : b.score - a.score,
  );
  const champ = applied[0];
  if (champ) {
    events.push({
      kind: "resilient",
      player: champ.runner.name,
      level: champ.level,
      score: champ.score,
      avatar: avatarFor(byName, champ.runner.name),
      context,
    });
  }

  return events;
}
