import { NextResponse } from "next/server";
import { createChallenge } from "altcha-lib/v1";

/**
 * Issues a fresh ALTCHA proof-of-work challenge to the recruit form.
 *
 * Each challenge is HMAC-signed with ALTCHA_HMAC_KEY (server-only env)
 * so we can verify on submit that the solution corresponds to a challenge
 * we actually issued — bots can't pre-compute solutions to fake challenges.
 *
 * The browser widget fetches this endpoint on page load (auto="onload"),
 * solves the SHA-256 brute-force in a Web Worker, and embeds the proof
 * in a hidden form field named `altcha`. The recruit POST handler verifies
 * that field via `verifySolution` from altcha-lib.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const hmacKey = process.env.ALTCHA_HMAC_KEY;
  if (!hmacKey) {
    return NextResponse.json(
      { error: "Captcha not configured" },
      { status: 503 },
    );
  }
  const challenge = await createChallenge({
    hmacKey,
    // Difficulty knob: bot has to find n in [0, maxnumber] where
    // sha256(salt + n) starts with the required leading bits. 100k =
    // ~50–200ms of CPU work per attempt on modern hardware. The point
    // isn't to slow legit users (one-time cost on form load) but to
    // make scripted spam economically painful.
    maxnumber: 100_000,
  });
  return NextResponse.json(challenge);
}
