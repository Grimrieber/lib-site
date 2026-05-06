import { NextResponse } from "next/server";
import { verifySolution } from "altcha-lib/v1";

/**
 * Recruitment form endpoint.
 *
 * Defense layers, top to bottom:
 *  1. Same-origin check  — Origin header must match the request host.
 *                          Stops cross-origin browser fetches and naive
 *                          curl scripts that don't set Origin.
 *  2. ALTCHA proof-of-work — browser-solved SHA-256 challenge per submit.
 *                          Spam at scale becomes CPU-expensive.
 *  3. Honeypot field     — hidden `website` input. Naive form-fillers
 *                          fill it; we silently ack and drop.
 *  4. Per-IP rate limit  — 5 submissions / 10 min window.
 *  5. Length caps        — bound payload size before relaying to Discord.
 *  6. Required fields    — block empty/malformed submissions.
 */

// Per-IP request log: timestamps in ms, oldest pruned. Lives in module
// memory (ephemeral on serverless cold starts — that's fine, the worst
// case is one extra burst per cold container).
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 min
const RATE_LIMIT_MAX = 5; // 5 submissions per IP per window
const recruitHits = new Map<string, number[]>();

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (recruitHits.get(ip) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (arr.length >= RATE_LIMIT_MAX) {
    recruitHits.set(ip, arr);
    return true;
  }
  arr.push(now);
  recruitHits.set(ip, arr);
  return false;
}

const MAX_FIELD_LEN = 2000; // hard upper bound per field
const MAX_TEXT_FIELD_LEN = 5000; // for "experience" / "why" longform

/**
 * Same-origin check. Browsers always set the Origin header on POSTs;
 * cross-origin fetches set it to the attacker's origin (or strip it).
 * Reject anything that doesn't match the request host.
 *
 * Spoofable by curl with `-H 'Origin: https://lib-site.vercel.app'`, but
 * raises the bar against drive-by browser-based abuse and naive scripts.
 * The captcha layer below catches the curl-with-spoofed-origin case.
 */
function isSameOrigin(req: Request): boolean {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

/**
 * Tracks ALTCHA payloads we've already accepted, so an attacker can't
 * scrape a valid `altcha` value from the page DOM and replay it via
 * curl. Module-scope, so it survives across requests within a warm
 * function instance. Cold starts reset the set — but cold starts also
 * cost the attacker a full new challenge fetch + solve, so the worst
 * case is one accepted replay per cold container per challenge TTL.
 *
 * Entries are pruned past ALTCHA_REPLAY_TTL_MS to keep memory bounded.
 * The TTL is set just past the challenge's own expiration (1h default)
 * so an attacker can't outlive the cache window with a stale token.
 */
const ALTCHA_REPLAY_TTL_MS = 75 * 60 * 1000; // 75 min
const usedAltchaPayloads = new Map<string, number>();

function pruneUsedAltchaPayloads(): void {
  const cutoff = Date.now() - ALTCHA_REPLAY_TTL_MS;
  for (const [token, ts] of usedAltchaPayloads) {
    if (ts < cutoff) usedAltchaPayloads.delete(token);
  }
}

/**
 * ALTCHA proof-of-work verification. The widget on the form solves a
 * server-issued SHA-256 brute-force challenge and embeds the proof in
 * the `altcha` form field. We verify three things here:
 *   1. The proof's HMAC signature matches our server key (issued by us).
 *   2. The number-of-tries solution is correct for the challenge.
 *   3. We haven't seen this exact proof payload before (replay defense).
 *
 * To enable in production: set ALTCHA_HMAC_KEY in Vercel env vars
 * (server-only, never exposed to browser). Generate a fresh value with
 * e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
 */
async function verifyAltcha(payload: unknown): Promise<boolean> {
  const hmacKey = process.env.ALTCHA_HMAC_KEY;
  if (!hmacKey) {
    // In production, fail-closed: refuse to accept submissions until
    // the captcha is configured. Without ALTCHA_HMAC_KEY the widget
    // can't issue challenges anyway, so any submission reaching here
    // is bypassing the form — definitionally a bot.
    if (process.env.VERCEL_ENV === "production") {
      console.warn(
        "[recruit] ALTCHA_HMAC_KEY unset in production — rejecting submission",
      );
      return false;
    }
    // Dev / preview / local prod build: fall through, honeypot + rate
    // limit + origin check still apply.
    return true;
  }
  if (typeof payload !== "string" || !payload) return false;

  // Replay defense: if this exact proof payload was already accepted,
  // reject before doing the (relatively expensive) HMAC verify.
  if (usedAltchaPayloads.has(payload)) {
    console.warn("[recruit] Altcha payload replay rejected");
    return false;
  }

  try {
    const valid = await verifySolution(payload, hmacKey);
    if (valid) {
      pruneUsedAltchaPayloads();
      usedAltchaPayloads.set(payload, Date.now());
    }
    return valid;
  } catch (err) {
    console.error("[recruit] Altcha verify failed:", err);
    return false;
  }
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many submissions. Try again later." },
      { status: 429 },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Honeypot: a hidden field bots commonly auto-fill. If it has content,
  // silently ack and drop. Real users never see/touch this field.
  if (typeof payload.website === "string" && payload.website.trim()) {
    return NextResponse.json({ ok: true });
  }

  // ALTCHA proof-of-work — the widget on the form puts a signed solution
  // in `payload.altcha`. Without a valid solution, refuse the submission.
  if (!(await verifyAltcha(payload.altcha))) {
    return NextResponse.json(
      { error: "Captcha verification failed. Refresh the page and retry." },
      { status: 400 },
    );
  }

  const required = [
    "applicantName",
    "discord",
    "characterName",
    "realm",
    "class",
    "role",
    "spec",
    "experience",
  ];
  for (const field of required) {
    if (typeof payload[field] !== "string" || !payload[field]) {
      return NextResponse.json(
        { error: `Missing field: ${field}` },
        { status: 400 },
      );
    }
  }

  // Hard length caps: prevents a malicious payload from posting a huge
  // message to the Discord webhook. Per-field bounded; longform fields
  // get a higher cap.
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v !== "string") continue;
    const max =
      k === "experience" || k === "why" ? MAX_TEXT_FIELD_LEN : MAX_FIELD_LEN;
    if (v.length > max) {
      return NextResponse.json(
        { error: `${k} is too long (max ${max} chars)` },
        { status: 400 },
      );
    }
  }

  const webhook = process.env.RECRUIT_DISCORD_WEBHOOK;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildDiscordPayload(payload)),
      });
    } catch (err) {
      console.error("[recruit] Discord webhook failed:", err);
      // We still 200 to the user — their application went somewhere even if delivery failed.
    }
  } else {
    console.log("[recruit] No webhook configured. Application:", payload);
  }

  return NextResponse.json({ ok: true });
}

/**
 * Class color hex (Discord embed colors are integers, so we encode each
 * WoW class color as a literal int). Match RIO/Wowhead conventions so
 * the embed sidebar reads like a Wowhead tooltip.
 */
const CLASS_COLOR: Record<string, number> = {
  "death knight": 0xc41e3a,
  "demon hunter": 0xa330c9,
  druid: 0xff7c0a,
  evoker: 0x33937f,
  hunter: 0xaad372,
  mage: 0x3fc7eb,
  monk: 0x00ff98,
  paladin: 0xf48cba,
  priest: 0xc0c0c0, // pure white reads invisible on the embed sidebar
  rogue: 0xfff468,
  shaman: 0x0070dd,
  warlock: 0x8788ee,
  warrior: 0xc69b6d,
};

/** Faction-aware default if the class isn't recognized. Alliance blue. */
const DEFAULT_EMBED_COLOR = 0x4a90e2;

const ROLE_EMOJI: Record<string, string> = {
  tank: "🛡️",
  healer: "💚",
  dps: "⚔️",
};

const ROLE_LABEL: Record<string, string> = {
  tank: "Tank",
  healer: "Healer",
  dps: "DPS",
};

/** URL helpers — produce safe links to RIO and the LIB logo. */
const SITE_URL = "https://lib-site.vercel.app";
const LIB_LOGO_URL = `${SITE_URL}/LIB_Logo.png`;

function rioCharUrl(realm: string, name: string): string {
  const slug = realm.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `https://raider.io/characters/us/${slug}/${encodeURIComponent(name)}`;
}

function buildDiscordPayload(p: Record<string, unknown>) {
  const className = String(p.class ?? "").trim();
  const classKey = className.toLowerCase();
  const color = CLASS_COLOR[classKey] ?? DEFAULT_EMBED_COLOR;
  const roleKey = String(p.role ?? "").toLowerCase();
  const roleEmoji = ROLE_EMOJI[roleKey] ?? "🎯";
  const roleLabel = ROLE_LABEL[roleKey] ?? (roleKey || "Raider");
  const characterName = String(p.characterName ?? "").trim();
  const realm = String(p.realm ?? "").trim();
  const spec = String(p.spec ?? "").trim();
  const offspec = String(p.offspec ?? "").trim();
  const battlenet = String(p.battlenet ?? "").trim();
  const logs = String(p.logs ?? "").trim();
  const experience = String(p.experience ?? "").slice(0, 1024);
  const why = String(p.why ?? "").trim().slice(0, 1024);
  const applicantName = String(p.applicantName ?? "").trim() || "Anonymous";
  const discord = String(p.discord ?? "").trim();

  // Top-line: who is this and how to reach them. The discord handle gets
  // backticked so it visually reads as an identity rather than prose.
  const headerLines: string[] = [
    `**Applicant**: ${applicantName}`,
    `**Discord**: \`${discord || "—"}\``,
  ];
  if (battlenet) headerLines.push(`**Battle.net**: \`${battlenet}\``);

  const fields: { name: string; value: string; inline?: boolean }[] = [
    {
      name: "Class · Spec",
      value: `**${spec || "—"}** ${className || "—"}`,
      inline: true,
    },
    {
      name: "Off-Spec",
      value: offspec || "—",
      inline: true,
    },
    {
      name: "Realm",
      value: realm || "—",
      inline: true,
    },
  ];

  if (logs) {
    // Rendered as a clickable link if it parses as a URL.
    const isUrl = /^https?:\/\//i.test(logs);
    fields.push({
      name: "📊 Logs",
      value: isUrl ? `[${logs}](${logs})` : logs,
      inline: false,
    });
  }

  if (experience) {
    fields.push({
      name: "📖 Raid Experience",
      value: experience,
      inline: false,
    });
  }

  if (why) {
    fields.push({ name: "🎯 Why LIB", value: why, inline: false });
  }

  // Build a clickable title: "Charname · Skullcrusher" → opens RIO. Falls
  // back to plain title if we don't have enough info to construct a URL.
  const charLink =
    characterName && realm ? rioCharUrl(realm, characterName) : undefined;
  const title = characterName
    ? `${roleEmoji} ${characterName}${realm ? ` · ${realm}` : ""}`
    : `${roleEmoji} New ${roleLabel} Application`;

  return {
    username: "LIB Recruitment",
    avatar_url: LIB_LOGO_URL,
    embeds: [
      {
        color,
        author: {
          name: `New ${roleLabel} Application`,
          icon_url: LIB_LOGO_URL,
          url: SITE_URL,
        },
        title,
        url: charLink,
        description: headerLines.join("\n"),
        thumbnail: { url: LIB_LOGO_URL },
        fields,
        footer: {
          text: `Lessons in Brutality · Skullcrusher (US-Alliance)`,
          icon_url: LIB_LOGO_URL,
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
