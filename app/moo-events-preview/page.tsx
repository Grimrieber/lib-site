import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { DeathStats } from "@/lib/battlenet";
import {
  getBoobDeathStats,
  getBoobRecentAchievements,
  describeNewDeaths,
  describeNewResurrections,
  describeAchievementSummary,
  buildKickoffPost,
} from "@/lib/moo-events";

/**
 * Throwaway design preview for the incremental #only-moo event posts:
 * - 🏆 a post when ZamboniBoob (MeatSupreme) earns a NEW achievement
 * - 💀 a "death report" when his death counters tick up
 * Uses his REAL live data (BNet achievements/statistics + recent_events). Death
 * posts are shown for a few simulated diffs against his real career totals.
 * Nothing is wired to a webhook. Not linked; noindex. Delete once signed off.
 */
export const metadata: Metadata = {
  title: "Only Moo — Events Preview",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const C = {
  page: "#313338",
  embed: "#2b2d31",
  white: "#f2f3f5",
  body: "#dbdee1",
  muted: "#949ba4",
};
const RED = "#e23b3b";
const GOLD = "#f0b232";
const MOO_GREEN = "#6aa84f";
const REZ_GREEN = "#43b581";

// Render Discord **bold** markdown as <strong>.
function MdText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} style={{ color: C.white }}>
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

// Render multi-line markdown (newlines preserved, **bold** styled).
function MdBlock({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) =>
        line === "" ? (
          <div key={i} style={{ height: 6 }} />
        ) : (
          <div key={i}>
            <MdText text={line} />
          </div>
        ),
      )}
    </>
  );
}

function Msg({
  emoji,
  accent,
  title,
  body,
  timestamp,
}: {
  emoji: string;
  accent: string;
  title: string;
  body: string;
  timestamp: string;
}) {
  return (
    <div style={{ display: "flex", gap: 16, padding: "2px 0 16px" }}>
      <div
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: "50%",
          background: "#1e1f22",
          border: `2px solid ${accent}`,
          boxShadow: `0 0 10px -2px ${accent}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
        }}
      >
        <span aria-hidden>{emoji}</span>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
          <span style={{ color: C.white, fontSize: 16, fontWeight: 600 }}>
            Daily Moo
          </span>
          <span
            style={{
              background: "#5865f2",
              color: "#fff",
              fontSize: 10,
              fontWeight: 600,
              padding: "1px 4px",
              borderRadius: 4,
              textTransform: "uppercase",
            }}
          >
            App
          </span>
          <span style={{ color: C.muted, fontSize: 12 }}>{timestamp}</span>
        </div>
        <div
          style={{
            maxWidth: 460,
            background: C.embed,
            borderRadius: 4,
            borderLeft: `4px solid ${accent}`,
            padding: "8px 16px 12px 12px",
          }}
        >
          <div
            style={{
              color: accent,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginTop: 4,
            }}
          >
            {title}
          </div>
          <div style={{ color: C.body, fontSize: 15, marginTop: 4, lineHeight: 1.45 }}>
            <MdBlock text={body} />
          </div>
        </div>
      </div>
    </div>
  );
}

const SECTION: React.CSSProperties = {
  color: "#949ba4",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1,
  margin: "28px 0 10px",
  borderBottom: "1px solid #3f4147",
  paddingBottom: 6,
};

// Build a simulated "previous" death snapshot by subtracting a scenario's
// deltas from his real current counters, so describeNewDeaths() produces the
// real post output for that scenario.
function simPrev(curr: DeathStats, deltas: Record<string, number>): DeathStats {
  const byName = { ...curr.byName };
  let total = curr.total ?? 0;
  for (const [k, d] of Object.entries(deltas)) {
    if (k === "Total deaths") total -= d;
    else if (byName[k] != null) byName[k] = byName[k] - d;
  }
  return { total, byName, updatedByName: curr.updatedByName, updatedAt: curr.updatedAt };
}

export default async function MooEventsPreviewPage() {
  // Throwaway design preview — dev-only. In production it's a 404 (before the
  // live BNet fetches below) so it adds zero public bot surface / Active CPU,
  // while staying usable under `next dev` for the unshipped #only-moo work.
  if (process.env.NODE_ENV === "production") notFound();
  const [deaths, achievements] = await Promise.all([
    getBoobDeathStats(),
    getBoobRecentAchievements(),
  ]);
  const kickoff = buildKickoffPost(deaths, achievements);

  const deathScenarios: { label: string; deltas: Record<string, number>; ts: string }[] = [
    { label: "fell to his death", deltas: { "Total deaths": 1, "Deaths from falling": 1 }, ts: "Today at 9:00 AM" },
    { label: "died in a delve", deltas: { "Total deaths": 1, "Total deaths in delves": 1 }, ts: "Today at 1:15 PM" },
    { label: "drowned", deltas: { "Total deaths": 1, "Deaths from drowning": 1 }, ts: "Yesterday" },
    {
      label: "a bad night",
      deltas: { "Total deaths": 4, "Deaths from falling": 1, "Total deaths in delves": 2, "Total deaths in dungeons": 1 },
      ts: "Tuesday",
    },
  ];

  const deathPosts = deaths
    ? deathScenarios
        .map((s) => ({ ts: s.ts, body: describeNewDeaths(simPrev(deaths, s.deltas), deaths) }))
        .filter((p): p is { ts: string; body: string } => !!p.body)
    : [];

  const rezScenarios: { deltas: Record<string, number>; ts: string }[] = [
    { deltas: { "Rebirthed by druids": 1 }, ts: "Today at 9:01 AM" },
    {
      deltas: { "Rebirthed by druids": 2, "Raised by death knights": 1 },
      ts: "Today at 1:16 PM",
    },
  ];
  const rezPosts = deaths
    ? rezScenarios
        .map((s) => ({
          ts: s.ts,
          body: describeNewResurrections(simPrev(deaths, s.deltas), deaths),
        }))
        .filter((p): p is { ts: string; body: string } => !!p.body)
    : [];

  return (
    <div
      style={{
        background: C.page,
        minHeight: "100vh",
        padding: "32px 20px 80px",
        fontFamily: "'gg sans','Noto Sans',Helvetica,Arial,sans-serif",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ color: C.white, fontSize: 22, fontWeight: 700, margin: 0 }}>
          # only-moo — live event posts preview
        </h1>
        <p style={{ color: "#b5bac1", fontSize: 14, marginTop: 8 }}>
          Incremental posts that fire when something new happens to{" "}
          <strong style={{ color: C.body }}>@ZamboniBoob</strong>: a 🏆 summary
          listing new achievements since the last check, and a 💀 death report
          when his death counters tick up
          (from BNet&rsquo;s Statistics tab — cumulative, so it&rsquo;s a
          tally-since-last-check, not real-time). All data below is{" "}
          <strong style={{ color: C.body }}>his real live numbers</strong>;
          deaths are shown for a few simulated diffs. Nothing is wired to a
          webhook yet.
        </p>

        <div style={SECTION}>🐄 Kickoff post — one-time, when we ship</div>
        <div style={{ display: "flex", gap: 16, padding: "2px 0 16px" }}>
          <div
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: "50%",
              background: "#1e1f22",
              border: `2px solid ${MOO_GREEN}`,
              boxShadow: `0 0 10px -2px ${MOO_GREEN}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
            }}
          >
            <span aria-hidden>🐄</span>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
              <span style={{ color: C.white, fontSize: 16, fontWeight: 600 }}>Daily Moo</span>
              <span style={{ background: "#5865f2", color: "#fff", fontSize: 10, fontWeight: 600, padding: "1px 4px", borderRadius: 4, textTransform: "uppercase" }}>App</span>
              <span style={{ color: C.muted, fontSize: 12 }}>on launch</span>
            </div>
            <div style={{ maxWidth: 460, background: C.embed, borderRadius: 4, borderLeft: `4px solid ${MOO_GREEN}`, padding: "8px 16px 14px 12px" }}>
              <div style={{ color: C.white, fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                {kickoff.title}
              </div>
              <div style={{ color: C.body, fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
                <MdBlock text={kickoff.description} />
              </div>
            </div>
          </div>
        </div>

        <div style={SECTION}>💀 Death reports (simulated diffs, real totals)</div>
        {deathPosts.length ? (
          deathPosts.map((p, i) => (
            <Msg
              key={i}
              emoji="💀"
              accent={RED}
              title="Death Report"
              body={p.body}
              timestamp={p.ts}
            />
          ))
        ) : (
          <p style={{ color: C.muted }}>
            Death stats unavailable (BNet may be rate-limited).
          </p>
        )}

        <div style={SECTION}>✨ Resurrection reports — the counterpart to deaths</div>
        {rezPosts.length ? (
          rezPosts.map((p, i) => (
            <Msg
              key={i}
              emoji="✨"
              accent={REZ_GREEN}
              title="Resurrection"
              body={p.body}
              timestamp={p.ts}
            />
          ))
        ) : (
          <p style={{ color: C.muted }}>(none)</p>
        )}

        <div style={SECTION}>🏆 Achievement summary — one post, listing new since last capture</div>
        {(() => {
          const sample = achievements.slice(0, 3).map((a) => a.name);
          const text = describeAchievementSummary(sample);
          return text ? (
            <Msg
              emoji="🏆"
              accent={GOLD}
              title="Achievements"
              body={text}
              timestamp="just now"
            />
          ) : (
            <p style={{ color: C.muted }}>No recent achievements found.</p>
          );
        })()}

        <p style={{ color: C.muted, fontSize: 13, marginTop: 28, lineHeight: 1.5 }}>
          To ship (later): store a baseline of his death counters + seen
          achievement ids in Upstash, re-poll each cycle, post the delta to
          <code style={{ color: C.body }}> DISCORD_WEBHOOK_MOO</code>. One extra
          BNet fetch (~88KB) per cycle — negligible CPU.
        </p>
      </div>
    </div>
  );
}
