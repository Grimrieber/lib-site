import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBoobRivalry, RIVALRY_PAIR } from "@/lib/moo-events";
import {
  buildRivalryPost,
  rivalryHeadline,
  type Rivalry,
} from "@/lib/moo-rivalry";

/**
 * Design preview for the #only-moo rivalry post: ZamboniBoob vs Churd on
 * achievement points, where each of them leads, and what one has that the
 * other doesn't.
 *
 * Real live BNet data for both characters. Nothing is wired to a webhook —
 * this page only renders. Dev-only (404 in production), not linked, noindex.
 */
export const metadata: Metadata = {
  title: "Only Moo — Rivalry Preview",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const C = {
  page: "#313338",
  embed: "#2b2d31",
  panel: "#1e1f22",
  white: "#f2f3f5",
  body: "#dbdee1",
  muted: "#949ba4",
};
const GOLD = "#f0b232";
const BOOB_C = "#6aa84f";
const CHURD_C = "#5865f2";

/** Render Discord **bold** and *italic* markdown, and the {boob} mention. */
function MdText({ text }: { text: string }) {
  const resolved = text
    .replace(/\{boob\}/g, "@ZamboniBoob")
    .replace(/\{kuja\}/g, "@Kujatas");
  const parts = resolved.split(/(\*\*[^*]+\*\*|\*[^*]+\*|@[A-Za-z]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) {
          return (
            <strong key={i} style={{ color: C.white }}>
              {p.slice(2, -2)}
            </strong>
          );
        }
        if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
          return <em key={i}>{p.slice(1, -1)}</em>;
        }
        if (p.startsWith("@")) {
          return (
            <span
              key={i}
              style={{
                background: "#3c4270",
                color: "#c9cdfb",
                borderRadius: 3,
                padding: "0 2px",
              }}
            >
              {p}
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function Embed({ lines }: { lines: string[] }) {
  return (
    <div style={{ display: "flex", gap: 0 }}>
      <div style={{ width: 4, background: GOLD, borderRadius: "4px 0 0 4px" }} />
      <div
        style={{
          background: C.embed,
          borderRadius: "0 4px 4px 0",
          padding: "12px 16px",
          flex: 1,
          minWidth: 0,
        }}
      >
        <div
          style={{
            color: C.white,
            fontWeight: 600,
            fontSize: 15,
            marginBottom: 8,
          }}
        >
          🥊 Achievement Points — the only rivalry that matters
        </div>
        {lines.map((l, i) => (
          <p
            key={i}
            style={{
              color: C.body,
              fontSize: 14,
              lineHeight: 1.5,
              margin: "0 0 6px",
            }}
          >
            <MdText text={l} />
          </p>
        ))}
      </div>
    </div>
  );
}

function Bar({
  label,
  mine,
  theirs,
}: {
  label: string;
  mine: number;
  theirs: number;
}) {
  const max = Math.max(mine, theirs, 1);
  const row = (v: number, color: string, who: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          color: C.muted,
          fontSize: 11,
          width: 86,
          textAlign: "right",
          flex: "0 0 auto",
        }}
      >
        {who}
      </span>
      <div
        style={{
          height: 14,
          width: `${(v / max) * 100}%`,
          background: color,
          borderRadius: 3,
          minWidth: 2,
        }}
      />
      <span
        style={{
          color: C.body,
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {v.toLocaleString("en-US")}
      </span>
    </div>
  );
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: C.white, fontSize: 13, marginBottom: 4 }}>{label}</div>
      <div style={{ display: "grid", gap: 3 }}>
        {row(mine, BOOB_C, RIVALRY_PAIR.mine)}
        {row(theirs, CHURD_C, RIVALRY_PAIR.theirs)}
      </div>
    </div>
  );
}

function ExclusiveList({
  title,
  color,
  items,
}: {
  title: string;
  color: string;
  items: { id: number; name: string; completedAt: number }[];
}) {
  return (
    <div style={{ flex: "1 1 20rem", minWidth: 0 }}>
      <div style={{ color, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        {title}
      </div>
      {items.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 13 }}>(none)</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {items.map((e) => (
            <li
              key={e.id}
              style={{ color: C.body, fontSize: 13, marginBottom: 3 }}
            >
              {e.name}{" "}
              <span style={{ color: C.muted, fontSize: 11 }}>
                {new Date(e.completedAt).toISOString().slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The gap flips — these two are within a few hundred points. Show the headline
 *  for all three states so the copy can be judged before it happens live. */
function flipVariants(r: Rivalry): { label: string; line: string }[] {
  return [
    { label: "Churd ahead (today)", line: rivalryHeadline(r, 0) },
    {
      label: "Dead level",
      line: rivalryHeadline({ ...r, pointsGap: 0, theirPoints: r.minePoints }, 0),
    },
    {
      label: "Boob ahead",
      line: rivalryHeadline(
        { ...r, pointsGap: -120, theirPoints: r.minePoints - 120 },
        0,
      ),
    },
  ];
}

export default async function MooRivalryPreviewPage() {
  // Dev-only: this renders real character data and unreleased copy.
  if (process.env.NODE_ENV === "production") notFound();

  const r = await getBoobRivalry();

  return (
    <div
      style={{
        background: C.page,
        minHeight: "100vh",
        padding: "32px 20px 64px",
        fontFamily:
          "'gg sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: "52rem", margin: "0 auto" }}>
        <h1 style={{ color: C.white, fontSize: 22, margin: "0 0 4px" }}>
          #only-moo · rivalry post
        </h1>
        <p style={{ color: C.muted, fontSize: 13, margin: "0 0 28px" }}>
          {RIVALRY_PAIR.mine} vs {RIVALRY_PAIR.theirs} — live Battle.net data,
          nothing posted anywhere. Dev-only page.
        </p>

        {!r ? (
          <div
            style={{
              background: C.panel,
              borderRadius: 6,
              padding: 16,
              color: C.body,
            }}
          >
            <strong style={{ color: GOLD }}>No data.</strong> One or both
            Battle.net fetches failed, so there is nothing to compare. The real
            job posts nothing in this state rather than reporting a fabricated
            gap — reload to retry.
          </div>
        ) : (
          <>
            <section style={{ marginBottom: 32 }}>
              <div
                style={{
                  color: C.muted,
                  fontSize: 11,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                What gets posted — four different weeks
              </div>
              <p style={{ color: C.muted, fontSize: 12, margin: "0 0 12px" }}>
                Same data, different seed. The phrasing rotates so it does not
                go stale; these are four real posts it would make.
              </p>
              <div style={{ display: "grid", gap: 14 }}>
                {[0, 1, 2, 3].map((seed) => (
                  <Embed key={seed} lines={buildRivalryPost(r, seed)} />
                ))}
              </div>
            </section>

            <section style={{ marginBottom: 32 }}>
              <div
                style={{
                  color: C.muted,
                  fontSize: 11,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                Headline, in all three states
              </div>
              <div
                style={{ background: C.panel, borderRadius: 6, padding: 16 }}
              >
                {flipVariants(r).map((v) => (
                  <div key={v.label} style={{ marginBottom: 10 }}>
                    <div
                      style={{ color: C.muted, fontSize: 11, marginBottom: 2 }}
                    >
                      {v.label}
                    </div>
                    <p style={{ color: C.body, fontSize: 14, margin: 0 }}>
                      <MdText text={v.line} />
                    </p>
                  </div>
                ))}
                <p
                  style={{
                    color: C.muted,
                    fontSize: 12,
                    margin: "12px 0 0",
                    borderTop: `1px solid ${C.embed}`,
                    paddingTop: 10,
                  }}
                >
                  They are {Math.abs(r.pointsGap)} points apart, so the lead
                  will change. The copy has to read correctly either way.
                </p>
              </div>
            </section>

            <section style={{ marginBottom: 32 }}>
              <div
                style={{
                  color: C.muted,
                  fontSize: 11,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                The numbers
              </div>
              <div
                style={{ background: C.panel, borderRadius: 6, padding: 16 }}
              >
                <Bar
                  label="Achievement points"
                  mine={r.minePoints}
                  theirs={r.theirPoints}
                />
                <Bar
                  label="Achievements earned"
                  mine={r.mineEarned}
                  theirs={r.theirEarned}
                />
              </div>
            </section>

            <section style={{ marginBottom: 32 }}>
              <div
                style={{
                  color: C.muted,
                  fontSize: 11,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                Where each one leads
              </div>
              <div
                style={{
                  background: C.panel,
                  borderRadius: 6,
                  padding: 16,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 24,
                }}
              >
                <div style={{ flex: "1 1 18rem", minWidth: 0 }}>
                  <div
                    style={{
                      color: BOOB_C,
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    {RIVALRY_PAIR.mine} ahead
                  </div>
                  {r.mineLeads.slice(0, 8).map((d) => (
                    <div
                      key={d.name}
                      style={{
                        color: C.body,
                        fontSize: 13,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <span>{d.name}</span>
                      <span
                        style={{
                          color: BOOB_C,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        +{d.delta.toLocaleString("en-US")}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ flex: "1 1 18rem", minWidth: 0 }}>
                  <div
                    style={{
                      color: CHURD_C,
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    {RIVALRY_PAIR.theirs} ahead
                  </div>
                  {r.theirLeads.slice(0, 8).map((d) => (
                    <div
                      key={d.name}
                      style={{
                        color: C.body,
                        fontSize: 13,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <span>{d.name}</span>
                      <span
                        style={{
                          color: CHURD_C,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {d.delta.toLocaleString("en-US")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <p style={{ color: C.muted, fontSize: 12, margin: "8px 0 0" }}>
                Category points nest (a parent counts its children), so these
                compare the two characters within a category — they do not sum
                to anyone&apos;s total.
              </p>
            </section>

            <section>
              <div
                style={{
                  color: C.muted,
                  fontSize: 11,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                Exclusives (newest first)
              </div>
              <div
                style={{
                  background: C.panel,
                  borderRadius: 6,
                  padding: 16,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 24,
                }}
              >
                <ExclusiveList
                  title={`${RIVALRY_PAIR.mine} has, ${RIVALRY_PAIR.theirs} does not`}
                  color={BOOB_C}
                  items={r.mineOnly}
                />
                <ExclusiveList
                  title={`${RIVALRY_PAIR.theirs} has, ${RIVALRY_PAIR.mine} does not`}
                  color={CHURD_C}
                  items={r.theirOnly}
                />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
