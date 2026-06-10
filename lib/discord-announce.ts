/**
 * Discord announcement feed — embed builder + webhook poster.
 *
 * Pure, side-effect-free except for `postAnnouncement` (which does the actual
 * HTTP POST). The detection layer (announce-detect.ts) produces AnnounceEvent
 * objects; this module turns each into the exact Discord webhook payload shown
 * in the approved preview at /discord-preview, and posts it.
 *
 * Design (locked via the preview): one "LIB Herald" webhook, but each event
 * posts under its own per-message avatar_url (an emoji-badge PNG hosted at
 * /announce/<kind>.png) so the message face differs per type. Four signals
 * per message: badge avatar, color stripe, title emoji, subject thumbnail.
 * Copy is in LIB voice — blunt, no "Congratulations!".
 */

import { GUILD } from "@/lib/config";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
  "https://lib-site.vercel.app";

const BOT_NAME = "LIB Herald";

// Per-kind visuals — mirror the preview exactly. `color` is the embed stripe
// (Discord wants an integer), `badge` is the avatar PNG basename in
// /public/announce.
const STYLE = {
  kill: { color: 0xe23b3b, badge: "kill" },
  record: { color: 0xf0b232, badge: "record" },
  pb: { color: 0x19c3d6, badge: "pb" },
  resilient: { color: 0xa368ff, badge: "resilient" },
  // Legendary orange — the rarest item color in WoW. Deliberately distinct
  // from the amber "record" embed so a seasonal title reads as a tier above.
  title: { color: 0xff8000, badge: "title" },
  reminder: { color: 0x5865f2, badge: "reminder" },
} as const;

/** Basenames of the avatar badge PNGs that must exist in /public/announce. */
export const BADGE_NAMES = Object.values(STYLE).map((s) => s.badge);

export type KillEvent = {
  kind: "kill";
  difficulty: "Mythic" | "Heroic";
  boss: string;
  /** Progression string, e.g. "4 / 9 M". */
  progress: string;
  bossIcon?: string;
  firstKill?: boolean;
  raiders?: number;
  /** Footer context, e.g. "MN Tier 1". */
  context?: string;
};

export type RecordEvent = {
  kind: "record";
  player: string;
  score: number;
  prevScore?: number;
  prevHolder?: string;
  /** Character render/avatar URL for the thumbnail. */
  avatar?: string;
  context?: string;
};

export type PbEvent = {
  kind: "pb";
  player: string;
  score: number;
  /** Increase over the previous best. Omitted for seed highlights (current
   *  top key) where there is no prior baseline to diff against. */
  delta?: number;
  dungeon?: string;
  level?: number;
  avatar?: string;
  context?: string;
};

export type ResilientEvent = {
  kind: "resilient";
  player: string;
  level: number;
  score: number;
  avatar?: string;
  context?: string;
};

export type TitleEvent = {
  kind: "title";
  player: string;
  /** Display title, e.g. "the Unbound Hero". */
  title: string;
  /** Season descriptor, e.g. "The War Within Season Three". */
  season: string;
  score: number;
  avatar?: string;
  context?: string;
};

export type ReminderEvent = { kind: "reminder" };

export type AnnounceEvent =
  | KillEvent
  | RecordEvent
  | PbEvent
  | ResilientEvent
  | TitleEvent
  | ReminderEvent;

type EmbedField = { name: string; value: string; inline?: boolean };
type Embed = {
  color: number;
  title: string;
  url?: string;
  description?: string;
  fields?: EmbedField[];
  thumbnail?: { url: string };
  footer?: { text: string };
  timestamp?: string;
};
type WebhookPayload = {
  username: string;
  avatar_url: string;
  embeds: Embed[];
};

const badgeUrl = (basename: string) => `${SITE_URL}/announce/${basename}.png`;

const footerText = (context?: string) =>
  context ? `${GUILD.name} · ${context}` : GUILD.name;

function buildEmbed(event: AnnounceEvent, nowIso: string): Embed {
  switch (event.kind) {
    case "kill": {
      const fields: EmbedField[] = [
        { name: "Progression", value: event.progress, inline: true },
      ];
      if (event.firstKill)
        fields.push({ name: "Pull", value: "First kill", inline: true });
      if (typeof event.raiders === "number")
        fields.push({
          name: "Raiders",
          value: String(event.raiders),
          inline: true,
        });
      return {
        color: STYLE.kill.color,
        title: `💀 ${event.difficulty.toUpperCase()} KILL — ${event.boss}`,
        description: "**LIB** drops the boss.",
        fields,
        thumbnail: event.bossIcon ? { url: event.bossIcon } : undefined,
        footer: { text: footerText(event.context) },
        timestamp: nowIso,
      };
    }
    case "record": {
      const fields: EmbedField[] = [
        {
          name: "New record",
          value: `${Math.round(event.score)} · ${event.player}`,
          inline: true,
        },
      ];
      if (typeof event.prevScore === "number")
        fields.push({
          name: "Previous",
          value: event.prevHolder
            ? `${Math.round(event.prevScore)} · ${event.prevHolder}`
            : String(Math.round(event.prevScore)),
          inline: true,
        });
      return {
        color: STYLE.record.color,
        title: "👑 NEW GUILD RECORD — M+ Score",
        description: `${event.player} takes the crown. Highest score in the guild.`,
        fields,
        thumbnail: event.avatar ? { url: event.avatar } : undefined,
        footer: { text: footerText(event.context) },
        timestamp: nowIso,
      };
    }
    case "pb": {
      const fields: EmbedField[] = [];
      if (event.dungeon && event.level)
        fields.push({
          name: "Key",
          value: `${event.dungeon} +${event.level}`,
          inline: true,
        });
      const hasDelta = typeof event.delta === "number" && event.delta > 0;
      fields.push({
        name: "Score",
        value: hasDelta
          ? `${Math.round(event.score)}  ▲ ${Math.round(event.delta as number)}`
          : String(Math.round(event.score)),
        inline: true,
      });
      const desc =
        event.dungeon && event.level
          ? `Timed ${event.dungeon} on a +${event.level}. Score climbs.`
          : "New personal best. Score climbs.";
      return {
        color: STYLE.pb.color,
        title: `📈 PERSONAL BEST — ${event.player}`,
        description: desc,
        fields,
        thumbnail: event.avatar ? { url: event.avatar } : undefined,
        footer: { text: footerText(event.context) },
        timestamp: nowIso,
      };
    }
    case "resilient": {
      return {
        color: STYLE.resilient.color,
        title: `🛡️ RESILIENT ${event.level} — ${event.player}`,
        description: `Every active dungeon timed at +${event.level} or higher. Locked in.`,
        fields: [
          { name: "Tier", value: `Resilient ${event.level}`, inline: true },
          { name: "Score", value: String(Math.round(event.score)), inline: true },
        ],
        thumbnail: event.avatar ? { url: event.avatar } : undefined,
        footer: { text: footerText(event.context) },
        timestamp: nowIso,
      };
    }
    case "title": {
      return {
        color: STYLE.title.color,
        title: `🏆 SEASONAL TITLE — ${event.player}`,
        description: `**${event.player}** earns **${event.title}** — top 0.1% of the region in Mythic+. The rarest title in the game.`,
        fields: [
          { name: "Title", value: event.title, inline: true },
          { name: "Score", value: String(Math.round(event.score)), inline: true },
          { name: "Season", value: event.season, inline: false },
        ],
        thumbnail: event.avatar ? { url: event.avatar } : undefined,
        footer: { text: footerText(event.context) },
        timestamp: nowIso,
      };
    }
    case "reminder": {
      return {
        color: STYLE.reminder.color,
        title: SITE_URL.replace(/^https?:\/\//, ""),
        url: SITE_URL,
        description:
          "Every kill, every key, every score — logged. See where you stand.",
        footer: { text: "House reminder" },
        timestamp: nowIso,
      };
    }
  }
}

/** Build the full Discord webhook payload for an event (avatar + embed). */
export function buildPayload(
  event: AnnounceEvent,
  nowIso: string = new Date().toISOString(),
): WebhookPayload {
  return {
    username: BOT_NAME,
    avatar_url: badgeUrl(STYLE[event.kind].badge),
    embeds: [buildEmbed(event, nowIso)],
  };
}

/**
 * POST a single announcement to the webhook. Resolves on 2xx, throws on any
 * non-2xx (the caller decides whether to swallow). Discord returns 204 on a
 * successful webhook execute.
 */
export async function postAnnouncement(
  event: AnnounceEvent,
  webhookUrl: string,
  nowIso?: string,
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPayload(event, nowIso)),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Discord webhook POST failed: ${res.status} ${res.statusText} ${body}`.trim(),
    );
  }
}

/**
 * Post several events in order, pausing briefly between sends to stay clear of
 * Discord's per-webhook rate limit (~5 req / 2s). Returns the count posted.
 * A single failed post stops the run and rethrows — the caller (route) is
 * responsible for not advancing the baseline past what actually posted.
 */
export async function postMany(
  events: AnnounceEvent[],
  webhookUrl: string,
  opts: { delayMs?: number; nowIso?: string } = {},
): Promise<number> {
  const delayMs = opts.delayMs ?? 350;
  let posted = 0;
  for (const event of events) {
    await postAnnouncement(event, webhookUrl, opts.nowIso);
    posted += 1;
    if (posted < events.length)
      await new Promise((r) => setTimeout(r, delayMs));
  }
  return posted;
}
