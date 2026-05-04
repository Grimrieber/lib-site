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
        body: JSON.stringify({
          username: "LIB Recruitment",
          embeds: [
            {
              title: `New application from ${payload.applicantName}`,
              fields: [
                { name: "Discord", value: String(payload.discord), inline: true },
                {
                  name: "Battle.net",
                  value: String(payload.battlenet || "—"),
                  inline: true,
                },
                {
                  name: "Character",
                  value: `${payload.characterName} - ${payload.realm}`,
                  inline: false,
                },
                {
                  name: "Class / Spec",
                  value: `${payload.class} (${payload.role}) - ${payload.spec}`,
                  inline: true,
                },
                {
                  name: "Off-spec",
                  value: String(payload.offspec || "—"),
                  inline: true,
                },
                { name: "Logs", value: String(payload.logs || "—") },
                {
                  name: "Experience",
                  value: String(payload.experience).slice(0, 1000),
                },
                { name: "Why LIB", value: String(payload.why || "—").slice(0, 1000) },
              ],
              timestamp: new Date().toISOString(),
            },
          ],
        }),
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
