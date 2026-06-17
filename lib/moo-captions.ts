import captionData from "@/data/moo-captions.json";

/**
 * Caption database for the #only-moo daily cow channel, loaded from
 * data/moo-captions.json (the editable "little database" — see its _readme).
 * Affectionate, cow-themed ribbing of ZamboniBoob (WoW char: MeatSupreme), our
 * Tauren Paladin. The twice-a-day job pairs a caption with a cow from
 * lib/moo-cows.ts. Kujatas/healer lines are kept rare; the focus is ZamboniBoob.
 *
 * Tokens, substituted by renderCaption():
 *   {boob} -> ZamboniBoob   {kuja} -> Kujatas
 * Dynamic templates additionally use {score}/{ilvl}/{raid}/{keylvl}, filled
 * from Raider.IO at post time (see renderDynamic / `needs`).
 */
export type Caption = { text: string; tags?: string[]; note?: string };
export type DynamicCaption = Caption & { needs?: string[] };

export const MOO_CAPTION_DB = captionData.captions as Caption[];
export const MOO_DYNAMIC_TEMPLATES =
  captionData.dynamicTemplates as DynamicCaption[];

/** Flat list of static caption texts (with {boob}/{kuja} tokens). */
export const MOO_CAPTIONS: readonly string[] = MOO_CAPTION_DB.map((c) => c.text);

export type MooMentions = { boob?: string; kuja?: string };

/**
 * Render a caption for Discord. With a configured user id the token becomes a
 * real `<@id>` ping; without one it falls back to a bold name (no ping).
 */
export function renderCaption(caption: string, m: MooMentions = {}): string {
  const boob = m.boob ? `<@${m.boob}>` : "**ZamboniBoob**";
  const kuja = m.kuja ? `<@${m.kuja}>` : "**Kujatas**";
  return caption.replace(/\{boob\}/g, boob).replace(/\{kuja\}/g, kuja);
}

/** Stats pulled from Raider.IO to fill dynamic templates + activity lines. */
export type MooStats = {
  score?: number;
  ilvl?: number;
  raid?: string;
  keylvl?: number;
  recentRuns?: { dungeon: string; level: number; timed: boolean }[];
};

/**
 * Pick the dynamic templates whose required stats are all present, with their
 * {score}/{ilvl}/{raid}/{keylvl} tokens filled. Returns [] when no stats are
 * available, so the job just falls back to the static pool.
 */
export function usableDynamicCaptions(stats: MooStats): string[] {
  const has = (k: string) => stats[k as keyof MooStats] != null;
  return MOO_DYNAMIC_TEMPLATES.filter((t) => (t.needs ?? []).every(has)).map(
    (t) =>
      t.text
        .replace(/\{score\}/g, String(stats.score))
        .replace(/\{ilvl\}/g, String(stats.ilvl))
        .replace(/\{raid\}/g, String(stats.raid))
        .replace(/\{keylvl\}/g, String(stats.keylvl)),
  );
}
