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

function buildDiscordPayload(p: Record<string, unknown>) {
  const className = String(p.class ?? "").trim();
  const classKey = className.toLowerCase();
  const color = CLASS_COLOR[classKey] ?? DEFAULT_EMBED_COLOR;
  const roleKey = String(p.role ?? "").toLowerCase();
  const roleEmoji = ROLE_EMOJI[roleKey] ?? "🎯";
  const roleLabel = ROLE_LABEL[roleKey] ?? (roleKey || "Raider");
  const characterName = String(p.characterName ?? "");
  const realm = String(p.realm ?? "");
  const spec = String(p.spec ?? "");
  const offspec = String(p.offspec ?? "").trim();
  const battlenet = String(p.battlenet ?? "").trim();
  const logs = String(p.logs ?? "").trim();
  const experience = String(p.experience ?? "").slice(0, 1024);
  const why = String(p.why ?? "").trim().slice(0, 1024);
  const applicantName = String(p.applicantName ?? "");
  const discord = String(p.discord ?? "");

  const fields: { name: string; value: string; inline?: boolean }[] = [
    {
      name: "Character",
      value: `**${characterName || "—"}** · ${realm || "—"}`,
      inline: true,
    },
    {
      name: "Class · Spec",
      value: `${className || "—"}\n${spec || "—"}`,
      inline: true,
    },
    {
      name: "Off-Spec",
      value: offspec || "—",
      inline: true,
    },
  ];

  if (battlenet) {
    fields.push({
      name: "Battle.net",
      value: `\`${battlenet}\``,
      inline: false,
    });
  }

  if (logs) {
    fields.push({ name: "📊 Logs", value: logs, inline: false });
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

  return {
    username: "LIB Recruitment",
    embeds: [
      {
        color,
        title: `${roleEmoji} New ${roleLabel} Application`,
        description: `**${applicantName || "Anonymous"}** · \`${discord || "—"}\``,
        fields,
        footer: {
          text: "Lessons in Brutality · Skullcrusher US",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
