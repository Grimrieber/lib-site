import { NextResponse } from "next/server";

/**
 * Recruitment form endpoint.
 *
 * Validates input + posts to RECRUIT_DISCORD_WEBHOOK if configured. Has a
 * basic in-memory rate limit (per IP) and a honeypot to absorb bot spam
 * without bothering legit applicants.
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
 * Cloudflare Turnstile verification. Validates the token the widget put on
 * the form against Cloudflare's siteverify endpoint. Returns true if the
 * submission is human-verified (or if no secret is configured — dev mode).
 *
 * To enable in production:
 *   1. Sign in at https://dash.cloudflare.com → Turnstile → Add site
 *   2. Mode: "Managed" (invisible most of the time)
 *   3. Set Vercel env vars:
 *        NEXT_PUBLIC_TURNSTILE_SITE_KEY  (client, published in HTML)
 *        TURNSTILE_SECRET                (server, never sent to browser)
 *
 * For local testing, Cloudflare publishes always-pass test keys at
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/ —
 * site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.
 */
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

async function verifyTurnstile(
  token: unknown,
  ip: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    // Dev fallback — honeypot + rate limit are still active.
    return true;
  }
  if (typeof token !== "string" || !token) return false;
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: ip,
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("[recruit] Turnstile verify failed:", err);
    return false;
  }
}

export async function POST(req: Request) {
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

  // Cloudflare Turnstile — second line of defense after the honeypot.
  // Sophisticated bots that ignore the honeypot still need a valid token.
  if (!(await verifyTurnstile(payload.cfTurnstileToken, ip))) {
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
